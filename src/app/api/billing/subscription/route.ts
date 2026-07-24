import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { getPlan } from '@/lib/plans'

// Read-only. Billing here is contractual/EFT-settled, not self-service --
// there is no subscribe/upgrade/cancel action on this route, only visibility
// into what an org is currently contracted for and its usage so far this period.
export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = ddbDocClient()

  const subResult = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `ORG#${orgId}`, SK: 'SUBSCRIPTION' },
  })).catch(err => {
    console.error('[billing/subscription] Subscription lookup failed', { orgId, error: err })
    return null
  })

  if (!subResult?.Item) {
    // Contractual billing — no subscription yet means nothing has been
    // negotiated/provisioned for this org, not an error.
    return NextResponse.json({ subscription: null })
  }

  const sub = subResult.Item
  const plan = getPlan(sub.plan_id)

  const effectiveBasePriceZar   = sub.override_base_price_zar   ?? plan?.basePriceZar   ?? 0
  const effectiveDocsIncluded   = sub.override_docs_included    ?? plan?.docsIncluded   ?? 0
  const effectiveOverageRateZar = sub.override_overage_rate_zar ?? plan?.overageRateZar ?? 0

  // Live usage this period -- same org-scoped-by-construction DOC# query
  // pattern /api/documents already uses, filtered to the current period.
  const docsResult = await db.send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression:          'orgId = :orgId AND createdAt >= :start AND createdAt < :end',
    ExpressionAttributeValues: {
      ':pk': `ORG#${orgId}`,
      ':prefix': 'DOC#',
      ':orgId': orgId,
      ':start': sub.billing_period_start,
      ':end': sub.billing_period_end,
    },
  })).catch(err => {
    console.error('[billing/subscription] Usage query failed', { orgId, error: err })
    return { Items: [] }
  })

  const docsUsed = docsResult.Items?.length ?? 0
  const overageDocs = Math.max(0, docsUsed - effectiveDocsIncluded)

  return NextResponse.json({
    subscription: {
      planId:               sub.plan_id,
      planName:             plan?.name ?? sub.plan_id,
      status:               sub.status,
      billingPeriodStart:   sub.billing_period_start,
      billingPeriodEnd:     sub.billing_period_end,
      basePriceZar:         effectiveBasePriceZar,
      docsIncluded:         effectiveDocsIncluded,
      overageRateZar:       effectiveOverageRateZar,
      docsUsed,
      overageDocs,
      estimatedOverageZar:  overageDocs * effectiveOverageRateZar,
    },
  })
}
