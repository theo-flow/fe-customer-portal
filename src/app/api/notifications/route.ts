import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'
import type { NotificationItem } from '@/lib/notifications'

export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await ddbDocClient().send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'NOTIFICATION#' },
    ScanIndexForward:          false,
    Limit:                     20,
  }))

  const notifications = (result.Items ?? []).map(item => ({
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
