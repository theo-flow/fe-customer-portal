import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { publishBusinessEvent } from '@/lib/hub-events'
import { resolveIdentity } from '@/lib/identity'
import type { Field as SchemaField } from '@/components/FieldInput'

const FORMS_TABLE = process.env.DYNAMODB_TABLE_FORMS ?? 'daai-insure-forms'

// Sub-phase 4 (Integration Hub): "Export" action for a validated Decode
// submission. Scope deliberately cut down to identity only (email + best-
// effort name) -- no real client's actual CRM field mapping is known yet,
// so exporting the full submission generically would just be guessed
// shape nobody asked for. See docs/integration-hub-status-and-next-steps.md
// for the fuller per-client design this is a first slice of.
//
// Decode never has a RecipientLink (it processes already-filled paper
// documents, not a per-recipient invite flow -- see shared/identity/resolve.py's
// docstring in the backend repo), so name resolution here is best-effort at
// best and will often come back null; only email reliably resolves.
export async function POST(
  req: NextRequest,
  { params }: { params: { docId: string } }
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { docId } = params
  const db = ddbDocClient()

  let orgIdOnDoc: string | undefined
  try {
    const doc = await db.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `DOC#${docId}`, SK: 'STATUS' },
    }))
    if (!doc.Item || doc.Item.orgId !== orgId) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    orgIdOnDoc = doc.Item.orgId as string
  } catch (err) {
    console.error('[status/export] DynamoDB GetCommand failed', { orgId, docId, error: err })
    return NextResponse.json({ error: 'Failed to load document' }, { status: 500 })
  }

  let fields: Record<string, string> = {}
  let schemaFields: SchemaField[] = []
  try {
    const formsResult = await db.send(new QueryCommand({
      TableName: FORMS_TABLE,
      IndexName: 'portal_doc_id-index',
      KeyConditionExpression: 'portal_doc_id = :pdid',
      ExpressionAttributeValues: { ':pdid': docId },
      Limit: 1,
    }))
    const pipelineItem = formsResult.Items?.[0]
    if (pipelineItem?.fields_json) {
      try {
        fields = JSON.parse(pipelineItem.fields_json as string)
      } catch {
        fields = {}
      }
    }
    const group = pipelineItem?.group as string | undefined
    if (group) {
      const schemaResult = await db.send(new GetCommand({
        TableName: TABLE,
        Key: { PK: `ORG#${orgIdOnDoc}`, SK: `SCHEMA#${group}` },
      }))
      schemaFields = (schemaResult.Item?.fields as SchemaField[]) ?? []
    }
  } catch (err) {
    console.error('[status/export] Failed to load extraction data', { orgId, docId, error: err })
    return NextResponse.json({ error: 'Failed to load extracted data' }, { status: 500 })
  }

  const identity = resolveIdentity(fields, schemaFields)
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
      source: 'decode_export',
      document_id: docId,
    },
  })

  if (!eventId) {
    return NextResponse.json({ error: 'Failed to queue export' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
