import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'

export async function POST(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const callerOrgId = claims['custom:org_id']
  if (!callerOrgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { docId?: string }
  try {
    body = await req.json()
  } catch (err) {
    console.error('[confirm] Failed to parse request body', { error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { docId } = body
  if (!docId) return NextResponse.json({ error: 'Missing docId' }, { status: 400 })

  const db  = ddbDocClient()
  const now = new Date().toISOString()

  try {
    const existing = await db.send(new GetCommand({ TableName: TABLE, Key: { PK: `DOC#${docId}`, SK: 'STATUS' } }))
    if (!existing.Item) {
      console.warn('[confirm] Document not found', { docId })
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    if (existing.Item.orgId !== callerOrgId) {
      console.warn('[confirm] Org mismatch', { docId, docOrgId: existing.Item.orgId, callerOrgId })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } catch (err) {
    console.error('[confirm] DynamoDB GetCommand failed', { docId, error: err })
    return NextResponse.json({ error: 'Failed to retrieve document' }, { status: 500 })
  }

  const updateExpr = 'SET #s = :s, updatedAt = :t'
  const exprNames  = { '#s': 'status' }
  const exprValues = { ':s': 'UPLOADED', ':t': now }

  try {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: { PK: `DOC#${docId}`, SK: 'STATUS' },
      UpdateExpression: updateExpr, ExpressionAttributeNames: exprNames, ExpressionAttributeValues: exprValues,
    }))

    await db.send(new UpdateCommand({
      TableName: TABLE, Key: { PK: `ORG#${callerOrgId}`, SK: `DOC#${docId}` },
      UpdateExpression: updateExpr, ExpressionAttributeNames: exprNames, ExpressionAttributeValues: exprValues,
    }))
  } catch (err) {
    console.error('[confirm] DynamoDB UpdateCommand failed', { docId, callerOrgId, error: err })
    return NextResponse.json({ error: 'Failed to confirm upload' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
