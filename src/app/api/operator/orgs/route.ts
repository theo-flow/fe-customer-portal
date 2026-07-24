import { ScanCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { isOperatorEmail } from '@/lib/operator'
import { getPlan } from '@/lib/plans'

// Read-only, platform-wide cross-org view -- gated by the same
// isOperatorEmail allowlist /api/admin/leads uses, not custom:org_id.
// No write actions of any kind here (stricter than /admin/leads, which at
// least has a status dropdown) -- this is visibility only, not a
// management console.
export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOperatorEmail(claims.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = ddbDocClient()

  const profiles = await db.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'SK = :sk',
    ExpressionAttributeValues: { ':sk': 'PROFILE' },
  })).catch(err => {
    console.error('[operator/orgs] Profile scan failed', err)
    return null
  })

  if (!profiles) {
    return NextResponse.json({ error: 'Failed to load orgs' }, { status: 500 })
  }

  const orgs = await Promise.all((profiles.Items ?? []).map(async (profile) => {
    const orgId = profile.orgId as string

    const subResult = await db.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `ORG#${orgId}`, SK: 'SUBSCRIPTION' },
    })).catch(() => null)

    const sub = subResult?.Item ?? null
    const plan = sub ? getPlan(sub.plan_id) : undefined

    const docsResult = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'DOC#', ':orgId': orgId },
      Select: 'COUNT',
    })).catch(() => null)

    return {
      orgId,
      orgName: (profile.orgName ?? '') as string,
      status: (profile.status ?? 'unknown') as string,
      subscribedProducts: (profile.subscribed_products ?? []) as string[],
      subscription: sub ? {
        planId: sub.plan_id as string,
        planName: plan?.name ?? sub.plan_id,
        status: sub.status as string,
      } : null,
      totalDocuments: docsResult?.Count ?? 0,
    }
  }))

  orgs.sort((a, b) => a.orgName.localeCompare(b.orgName))

  return NextResponse.json({ orgs })
}
