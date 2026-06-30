import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'

export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await ddbDocClient().send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'SUBMISSION#' },
    ScanIndexForward:          false,
  }))

  const submissions = (result.Items ?? []).map(item => ({
    submissionId: item.submissionId as string,
    group:        item.group        as string,
    groupLabel:   item.group_label  as string,
    submittedAt:  item.submittedAt  as string,
    status:       item.status       as string,
  }))

  return NextResponse.json({ submissions })
}
