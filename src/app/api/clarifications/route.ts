import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'

const FORMS_TABLE = process.env.DYNAMODB_TABLE_FORMS ?? 'daai-insure-forms'

// The "needs clarification" queue -- docs/decode-redesign.md Phase 5: "even
// a simple internal queue view is enough to start, ahead of any outbound-
// to-client integration." Deliberately minimal: a Query plus a per-item
// status check, not a dedicated GSI -- correction records are the audit
// trail (every confirm/correct/clarify action, forever), but only a
// clarify record whose submission is *still* PARTIAL is actually pending;
// once someone resolves it, the submission moves on and it drops off here
// without needing to touch the correction record itself.
export async function GET(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = ddbDocClient()

  let correctionItems: Record<string, unknown>[] = []
  try {
    const result = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':skPrefix': 'CORRECTION#', ':clarify': 'clarify' },
      FilterExpression: 'resolution_type = :clarify',
    }))
    correctionItems = (result.Items ?? []) as Record<string, unknown>[]
  } catch (err) {
    console.error('[clarifications] Query failed', { orgId, error: err })
    return NextResponse.json({ error: 'Failed to load clarification requests' }, { status: 500 })
  }

  // Only the latest clarify record per (submission, field) matters -- an
  // earlier one superseded by a later action (however that happened) isn't
  // still pending. Keep the most recent by reviewed_at.
  const latestByField = new Map<string, Record<string, unknown>>()
  for (const item of correctionItems) {
    if (item.resolution_type !== 'clarify') continue
    const key = `${item.submission_id}#${item.field_key}`
    const existing = latestByField.get(key)
    if (!existing || (item.reviewed_at as string) > (existing.reviewed_at as string)) {
      latestByField.set(key, item)
    }
  }

  const documentIds = Array.from(new Set(Array.from(latestByField.values()).map(i => i.document_id as string)))
  const stillPartial = new Set<string>()
  await Promise.all(documentIds.map(async documentId => {
    try {
      const res = await db.send(new GetCommand({
        TableName: FORMS_TABLE,
        Key: { document_id: documentId },
      }))
      if (res.Item?.status === 'PARTIAL') stillPartial.add(documentId)
    } catch (err) {
      console.error('[clarifications] Submission status lookup failed', { documentId, error: err })
    }
  }))

  const pending = Array.from(latestByField.values())
    .filter(i => stillPartial.has(i.document_id as string))
    .map(i => ({
      documentId:     i.document_id,
      submissionId:   i.submission_id,
      fieldKey:       i.field_key,
      extractedValue: i.extracted_value,
      documentType:   i.document_type,
      reviewedAt:     i.reviewed_at,
    }))
    .sort((a, b) => (a.reviewedAt as string) < (b.reviewedAt as string) ? 1 : -1)

  return NextResponse.json({ items: pending })
}
