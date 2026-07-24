import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'

function mapStatus(raw: string): 'pending' | 'received' | 'processing' | 'complete' | 'failed' {
  switch (raw) {
    case 'PENDING':    return 'pending'
    case 'UPLOADED':   return 'received'
    case 'CLASSIFIED':
    case 'EXTRACTED':
    case 'VALIDATED':
    case 'FILED':      return 'processing'
    case 'COMPLETE':   return 'complete'
    default:           return 'failed'
  }
}

export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await ddbDocClient().send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    // FilterExpression enforces tenant isolation at the data layer
    FilterExpression:          'orgId = :orgId',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'DOC#', ':orgId': orgId },
    ScanIndexForward:          false,
  }))

  const items = (result.Items ?? []).map(item => ({
    docId:      item.docId      as string,
    group:      item.group      as string,
    groupLabel: item.groupLabel as string,
    filename:   item.filename   as string,
    status:     mapStatus(item.status as string),
    createdAt:  item.createdAt  as string,
  }))

  const total      = items.length
  const processing = items.filter(i => i.status === 'processing' || i.status === 'received').length
  const complete   = items.filter(i => i.status === 'complete').length
  const failed     = items.filter(i => i.status === 'failed').length

  return NextResponse.json({ items, total, processing, complete, failed })
}
