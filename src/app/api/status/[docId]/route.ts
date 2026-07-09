import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import type { Field as SchemaField } from '@/components/FieldInput'

const FORMS_TABLE = process.env.DYNAMODB_TABLE_FORMS ?? 'daai-insure-forms'

interface ReviewData {
  fields:            Record<string, string>
  schemaFields:       SchemaField[]
  aiResolvedFields:   string[]
  flaggedFields:      string[]
  unresolvedFields:   string[]
}

// Portal statuses (presign/confirm APIs)
function portalStatusToActiveStage(status: string): number {
  switch (status) {
    case 'PENDING':  return 0
    case 'UPLOADED': return 1
    default:         return 0
  }
}

// Pipeline statuses (fn-01 → fn-06)
function pipelineStatusToActiveStage(status: string): number | null {
  switch (status) {
    case 'RECEIVED':   return 1
    case 'CLASSIFIED': return 2
    case 'EXTRACTING': return 3
    case 'EXTRACTED':  return 3
    case 'RESOLVING':  return 3
    case 'VALIDATED':  return 4
    case 'VALID':      return 4
    case 'INVALID':    return 4
    case 'PARTIAL':    return 4
    case 'FILED':      return 5
    case 'COMPLETE':   return -1
    default:           return null
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { docId: string } }
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { docId } = params
  const db = ddbDocClient()

  const result = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `DOC#${docId}`, SK: 'STATUS' },
  }))

  if (!result.Item) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { status: portalStatus, product, docType, filename, fileSize, createdAt } = result.Item

  // Try to get live pipeline status from daai-insure-forms via GSI
  let activeStage = portalStatusToActiveStage(portalStatus as string)
  let failed = false
  let validationErrors: string[] = []
  let review: ReviewData | null = null
  try {
    const formsResult = await db.send(new QueryCommand({
      TableName: FORMS_TABLE,
      IndexName: 'portal_doc_id-index',
      KeyConditionExpression: 'portal_doc_id = :pdid',
      ExpressionAttributeValues: { ':pdid': docId },
      Limit: 1,
    }))
    const pipelineItem = formsResult.Items?.[0]
    if (pipelineItem?.status) {
      const pipelineStage = pipelineStatusToActiveStage(pipelineItem.status as string)
      if (pipelineStage !== null) activeStage = pipelineStage
      // INVALID is a terminal rejection, not "still validating" — surface it
      // distinctly so the portal doesn't show a document stuck "in progress" forever.
      if (pipelineItem.status === 'INVALID') {
        failed = true
        validationErrors = Array.isArray(pipelineItem.validation_errors)
          ? pipelineItem.validation_errors
          : []
      }

      // PARTIAL means a human must review before this can proceed -- surface
      // the extracted fields plus the org's schema so the portal can render
      // a pre-filled, editable review form.
      if (pipelineItem.status === 'PARTIAL') {
        let fields: Record<string, string> = {}
        try {
          fields = pipelineItem.fields_json ? JSON.parse(pipelineItem.fields_json as string) : {}
        } catch {
          fields = {}
        }

        let schemaFields: SchemaField[] = []
        const orgId = pipelineItem.org_id as string | undefined
        const group = pipelineItem.group as string | undefined
        if (orgId && group) {
          try {
            const schemaResult = await db.send(new GetCommand({
              TableName: TABLE,
              Key: { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}` },
            }))
            schemaFields = (schemaResult.Item?.fields as SchemaField[]) ?? []
          } catch {
            schemaFields = []
          }
        }

        review = {
          fields,
          schemaFields,
          aiResolvedFields: Array.isArray(pipelineItem.ai_resolved_fields) ? pipelineItem.ai_resolved_fields : [],
          flaggedFields:    Array.isArray(pipelineItem.flagged_fields)     ? pipelineItem.flagged_fields     : [],
          unresolvedFields: Array.isArray(pipelineItem.unresolved_fields)  ? pipelineItem.unresolved_fields  : [],
        }
      }
    }
  } catch {
    // GSI not yet available or no record yet — fall back to portal status
  }

  return NextResponse.json({
    docId,
    status: portalStatus,
    activeStage,
    failed,
    validationErrors,
    review,
    product: product ?? 'decode',
    docType: docType ?? '',
    filename,
    fileSize,
    createdAt,
  })
}
