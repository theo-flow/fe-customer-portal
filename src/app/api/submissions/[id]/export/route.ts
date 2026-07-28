import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { publishBusinessEvent } from '@/lib/hub-events'
import { resolveIdentity } from '@/lib/identity'
import type { Field as SchemaField } from '@/components/FieldInput'

// Sub-phase 4 (Integration Hub): "Export" action for a Harvest submission.
// Same scope cut as the Decode export route (src/app/api/status/[docId]/export/route.ts)
// -- identity only (email + best-effort name), not the full submission,
// since no real client's CRM field mapping is known yet.
//
// Harvest's only status is RECEIVED (nothing transitions it further), so
// unlike Decode there's no "is this validated yet" gate beyond the
// submission existing at all -- the frontend's action block still only
// shows this button once the page has successfully loaded a submission.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = ddbDocClient()

  const result = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `SUBMISSION#${params.id}` },
  }))

  const item = result.Item
  if (!item) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })

  const group = item.group as string
  const values = (item.values as Record<string, string>) ?? {}

  let schemaFields: SchemaField[] = []
  try {
    const schemaResult = await db.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}` },
    }))
    schemaFields = (schemaResult.Item?.fields as SchemaField[]) ?? []
  } catch {
    schemaFields = []
  }

  // recipient_name/recipient_email are only present when the submitter came
  // through a tokenized recipient-invite link -- absent on the org-direct-
  // share path. resolveIdentity() falls through to the schema/regex tiers
  // when they're undefined, same as it does for Decode.
  const identity = resolveIdentity(
    values,
    schemaFields,
    item.recipient_name as string | undefined,
    item.recipient_email as string | undefined,
  )
  if (!identity) {
    return NextResponse.json(
      { error: 'No identifiable contact (email) found on this submission' },
      { status: 400 },
    )
  }

  const eventId = await publishBusinessEvent('ExportRequested', orgId, {
    object_type: 'Contact',
    object: {
      email: identity.email,
      name: identity.name,
      source: 'harvest_export',
      submission_id: params.id,
    },
  })

  if (!eventId) {
    return NextResponse.json({ error: 'Failed to queue export' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
