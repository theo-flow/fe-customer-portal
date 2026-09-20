import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { forbiddenUnlessAdmin } from '@/lib/roles'
import type { AuditEntry } from '@/lib/audit'

const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 100

// The org's activity log, newest first. Admin only: it shows what every member did.
// Paged with an opaque cursor so a long history is never loaded at once.
export async function GET(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = forbiddenUnlessAdmin(claims)
  if (denied) return denied

  const params = req.nextUrl.searchParams
  const asked  = Number(params.get('limit'))
  const limit  = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT

  // The cursor is the last key the previous page ended on. It is decoded, then
  // checked to belong to THIS org's audit partition, so a hand-made cursor cannot
  // be used to read anywhere else.
  let startKey: Record<string, string> | undefined
  const cursor = params.get('cursor')
  if (cursor) {
    try {
      const key = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as Record<string, string>
      if (key.PK !== `ORG#${orgId}` || typeof key.SK !== 'string' || !key.SK.startsWith('AUDIT#')) throw new Error('bad')
      startKey = { PK: key.PK, SK: key.SK }
    } catch {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
    }
  }

  const result = await ddbDocClient().send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'AUDIT#' },
    ScanIndexForward:          false,
    Limit:                     limit,
    ExclusiveStartKey:         startKey,
  }))

  const entries: AuditEntry[] = (result.Items ?? []).map(item => ({
    auditId:    item.auditId    as string,
    at:         item.at         as string,
    actorSub:   item.actorSub   as string,
    actorEmail: item.actorEmail as string,
    actorRole:  item.actorRole === 'admin' ? 'admin' : 'agent',
    action:     item.action     as AuditEntry['action'],
    target:     (item.target as string | null) ?? null,
  }))

  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify({ PK: result.LastEvaluatedKey.PK, SK: result.LastEvaluatedKey.SK })).toString('base64url')
    : null

  return NextResponse.json({ entries, nextCursor })
}
