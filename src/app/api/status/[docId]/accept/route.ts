import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { ddbDocClient, sqsClient, TABLE } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'
import { validateField } from '@/lib/validators'
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

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { docId } = params

  let body: { fields?: Record<string, string> }
  try {
    body = await req.json()
  } catch (err) {
    console.error('[status/accept] Failed to parse request body', { docId, error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const fields = body.fields ?? {}

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

  const errors = validateAgainstSchema(fields, schemaFields)
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 })
  }

  const documentId = pipelineItem.document_id as string
  const now = new Date().toISOString()

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
        ':status': 'VALIDATED', // document-level terminal status, matches fn-06's clean-pass value
        ':ve':     [],
        ':arf':    [],
        ':ff':     [],
        ':uf':     [],
        ':ua':     now,
      },
    }))
  } catch (err) {
    console.error('[status/accept] DynamoDB UpdateCommand failed', { docId, documentId, error: err })
    return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
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
