import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { ddbDocClient, sqsClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { validateField } from '@/lib/validators'
import { writeCorrectionRecords, type Resolution } from '@/lib/corrections'
import type { Field as SchemaField } from '@/components/FieldInput'

const FORMS_TABLE      = process.env.DYNAMODB_TABLE_FORMS ?? 'daai-insure-forms'
const SQS_GENERATE_URL = process.env.SQS_GENERATE_URL

const NUMBER_RE = /^-?\d+(\.\d+)?$/

// TS port of fn-06's validate_against_schema -- required + per-field_type
// checks driven by the org's own published FormSchema. validateField covers
// sa_id/phone/date/email/currency; select-options and number/checkbox
// membership checks are added here to fully mirror fn-06's dispatcher.
function validateAgainstSchema(
  fields: Record<string, string>,
  schemaFields: SchemaField[],
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const f of schemaFields) {
    const value = fields[f.key] ?? ''

    const err = validateField(f.field_type, value, f.required, f.label)
    if (err) {
      errors[f.key] = err
      continue
    }
    if (!value || !value.trim()) continue // optional + empty -- nothing further to check

    if (f.field_type === 'select' && f.options && !f.options.includes(value)) {
      errors[f.key] = `${f.label} must be one of the allowed options`
    } else if (f.field_type === 'number' && !NUMBER_RE.test(value.trim())) {
      errors[f.key] = `${f.label} must be a valid number`
    } else if (f.field_type === 'checkbox' && !['true', 'false'].includes(value.trim().toLowerCase())) {
      errors[f.key] = `${f.label} must be checked or unchecked`
    }
  }
  return errors
}

export async function POST(
  req: NextRequest,
  { params }: { params: { docId: string } },
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { docId } = params

  let body: { fields?: Record<string, string>; resolutions?: Resolution[] }
  try {
    body = await req.json()
  } catch (err) {
    console.error('[status/accept] Failed to parse request body', { docId, error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const fields = body.fields ?? {}
  const resolutions = body.resolutions ?? []
  // A field flagged for clarification can't be resolved by the reviewer --
  // the document isn't necessarily wrong, it's incomplete pending an answer
  // from whoever submitted it (docs/decode-redesign.md Phase 5) -- so it's
  // excluded from the strict pass/fail check below rather than blocking
  // every other field the reviewer *did* resolve.
  const clarifyKeys = new Set(
    resolutions.filter(r => r.resolutionType === 'clarify').map(r => r.fieldKey)
  )

  const db = ddbDocClient()

  let pipelineItem: Record<string, unknown> | undefined
  try {
    const formsResult = await db.send(new QueryCommand({
      TableName: FORMS_TABLE,
      IndexName: 'portal_doc_id-index',
      KeyConditionExpression: 'portal_doc_id = :pdid',
      ExpressionAttributeValues: { ':pdid': docId },
      Limit: 1,
    }))
    pipelineItem = formsResult.Items?.[0]
  } catch (err) {
    console.error('[status/accept] DynamoDB QueryCommand failed', { docId, error: err })
    return NextResponse.json({ error: 'Failed to load submission' }, { status: 500 })
  }

  if (!pipelineItem) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
  }
  if (pipelineItem.org_id !== orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (pipelineItem.status !== 'PARTIAL') {
    return NextResponse.json(
      { error: `Submission is not awaiting review (status: ${pipelineItem.status})` },
      { status: 409 },
    )
  }

  const group = pipelineItem.group as string
  let schemaFields: SchemaField[] = []
  try {
    const schemaResult = await db.send(new GetCommand({
      TableName: TABLE,
      Key:       { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}` },
    }))
    schemaFields = (schemaResult.Item?.fields as SchemaField[]) ?? []
  } catch (err) {
    console.error('[status/accept] DynamoDB GetCommand (schema) failed', { docId, orgId, group, error: err })
    return NextResponse.json({ error: 'Failed to load schema' }, { status: 500 })
  }

  const fieldsToValidate = schemaFields.filter(f => !clarifyKeys.has(f.key))
  const errors = validateAgainstSchema(fields, fieldsToValidate)
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 })
  }

  const documentId = pipelineItem.document_id as string
  const now = new Date().toISOString()

  // Structured feedback: one discrete record per field the reviewer acted
  // on, regardless of outcome -- confirm/correct/clarify all get captured,
  // not just corrections. This is the actual Phase 5 ask; everything below
  // is the existing accept-the-submission flow, now branching on whether
  // anything was flagged for clarification.
  if (resolutions.length > 0) {
    try {
      await writeCorrectionRecords(resolutions.map(r => ({
        orgId:          orgId,
        submissionId:   pipelineItem!.submission_id as string,
        documentId,
        fieldKey:       r.fieldKey,
        resolutionType: r.resolutionType,
        extractedValue: (pipelineItem!.fields_json ? JSON.parse(pipelineItem!.fields_json as string)[r.fieldKey] : '') ?? '',
        correctedValue: r.resolutionType === 'corrected' ? (r.correctedValue ?? fields[r.fieldKey] ?? null) : null,
        schemaPresent:  schemaFields.length > 0,
        documentType:   (pipelineItem!.group as string) || (pipelineItem!.form_type as string) || 'unknown',
        reviewedAt:     now,
      })))
    } catch (err) {
      // Don't fail the whole accept action over feedback-capture logging --
      // the submission update below is what actually matters to the user.
      console.error('[status/accept] Failed to write correction records', { docId, documentId, error: err })
    }
  }

  const hasClarifications = clarifyKeys.size > 0

  try {
    await db.send(new UpdateCommand({
      TableName: FORMS_TABLE,
      Key: { document_id: documentId },
      UpdateExpression: [
        'SET fields_json = :fj',
        '#st = :status',
        'validation_errors = :ve',
        'ai_resolved_fields = :arf',
        'flagged_fields = :ff',
        'unresolved_fields = :uf',
        'updated_at = :ua',
      ].join(', '),
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':fj':     JSON.stringify(fields),
        // Stays PARTIAL, not VALIDATED, while anything is still waiting on
        // the client -- the document isn't wrong, it's incomplete.
        ':status': hasClarifications ? 'PARTIAL' : 'VALIDATED',
        ':ve':     [],
        ':arf':    [],
        ':ff':     [],
        ':uf':     hasClarifications ? Array.from(clarifyKeys) : [],
        ':ua':     now,
      },
    }))
  } catch (err) {
    console.error('[status/accept] DynamoDB UpdateCommand failed', { docId, documentId, error: err })
    return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
  }

  if (hasClarifications) {
    return NextResponse.json({ ok: true, pendingClarification: Array.from(clarifyKeys) })
  }

  if (!SQS_GENERATE_URL) {
    console.error('[status/accept] SQS_GENERATE_URL not configured')
    return NextResponse.json({ error: 'Generation is not configured' }, { status: 500 })
  }

  try {
    await sqsClient().send(new SendMessageCommand({
      QueueUrl: SQS_GENERATE_URL,
      MessageBody: JSON.stringify({
        document_id:       documentId,
        submission_id:     pipelineItem.submission_id,
        correlation_id:    randomUUID(),
        form_type:         pipelineItem.form_type,
        status:            'VALID', // submission-level status, matches fn-06's route_payload shape
        validation_errors: [],
      }),
    }))
  } catch (err) {
    console.error('[status/accept] Failed to publish generate message', { docId, documentId, error: err })
    return NextResponse.json({ error: 'Failed to queue generation' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
