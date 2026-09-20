import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import type { NotificationItem } from '@/lib/notifications'

export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Notifications addressed to a specific agent (target_sub) are only visible
  // to that agent; everything else is org-wide. No Query Limit: it caps items
  // examined before the filter runs, so it would hide this agent's items
  // behind other agents' notifications. The 20-item cap is applied after.
  const result = await ddbDocClient().send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression:          'attribute_not_exists(target_sub) OR target_sub = :sub',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'NOTIFICATION#', ':sub': claims.sub },
    ScanIndexForward:          false,
  }))

  const notifications = (result.Items ?? []).slice(0, 20).map(item => ({
    notificationId: item.notificationId as string,
    submissionId:   item.submissionId   as string,
    group:          item.group          as string,
    groupLabel:     item.groupLabel     as string,
    message:        item.message        as string,
    status:         item.status         as NotificationItem['status'],
    read:           Boolean(item.read),
    createdAt:      item.createdAt      as string,
  }))

  const unreadCount = notifications.filter(n => !n.read).length

  return NextResponse.json({ notifications, unreadCount })
}
