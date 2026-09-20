import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { forbiddenUnlessAdmin } from '@/lib/roles'
import { orgAccess } from '@/lib/org-access'
import { PAID_PLAN_ID } from '@/lib/plans'
import { computeSeatCharge, MAX_SEATS } from '@/lib/seat-pricing'
import { addOneMonth, isoUtc } from '@/lib/dates'
import { writeAudit } from '@/lib/audit'

// Starts the paid plan straight away, instead of waiting for the pilot to end and
// the automatic conversion. Admin only. Nothing is charged here: this creates the
// Subscription and marks it due, and fn-16's daily run issues the first invoice
// (the portal never builds PDFs), so the invoice follows within a day. Billing is
// contractual, settled by EFT.
//
// Also the way back for an org whose pilot was cancelled (or whose subscription
// was), as the reminder email promises.
export async function POST(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = forbiddenUnlessAdmin(claims)
  if (denied) return denied

  let body: { seats?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const seats = body.seats
  if (!Number.isInteger(seats) || (seats as number) < 1 || (seats as number) > MAX_SEATS) {
    return NextResponse.json({ error: `Choose a whole number of seats from 1 to ${MAX_SEATS}.` }, { status: 400 })
  }

  const access = await orgAccess(orgId)
  if (access.state === 'active') {
    return NextResponse.json({ error: 'You are already on the paid plan. Change your seats from Team.' }, { status: 409 })
  }

  const db  = ddbDocClient()
  const now = new Date()
  const nowIso = isoUtc(now)
  const key = { PK: `ORG#${orgId}`, SK: 'SUBSCRIPTION' }
  const period = { billing_period_start: nowIso, billing_period_end: isoUtc(addOneMonth(now)) }

  try {
    const existing = await db.send(new GetCommand({ TableName: TABLE, Key: key }))
    if (existing.Item) {
      // A cancelled subscription coming back.
      await db.send(new UpdateCommand({
        TableName:                 TABLE,
        Key:                       key,
        UpdateExpression:          'SET #st = :active, billing_period_start = :start, billing_period_end = :end, next_invoice_at = :now, updated_at = :now',
        ConditionExpression:       '#st = :cancelled',
        ExpressionAttributeNames:  { '#st': 'status' },
        ExpressionAttributeValues: {
          ':active': 'active', ':cancelled': 'cancelled', ':start': period.billing_period_start,
          ':end': period.billing_period_end, ':now': nowIso,
        },
      }))
    } else {
      await db.send(new PutCommand({
        TableName: TABLE,
        Item: {
          ...key,
          org_id:          orgId,
          plan_id:         PAID_PLAN_ID,
          status:          'active',
          ...period,
          next_invoice_at: nowIso,
          created_at:      nowIso,
          updated_at:      nowIso,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }))
    }

    await db.send(new UpdateCommand({
      TableName:                 TABLE,
      Key:                       { PK: `ORG#${orgId}`, SK: 'PROFILE' },
      UpdateExpression:          'SET seats = :seats, trial_status = :converted',
      ConditionExpression:       'attribute_exists(PK)',
      ExpressionAttributeValues: { ':seats': seats, ':converted': 'converted' },
    }))
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return NextResponse.json({ error: 'Your plan just changed. Refresh and try again.' }, { status: 409 })
    }
    console.error('[billing/subscribe] Failed', { orgId, error: err })
    return NextResponse.json({ error: 'Could not start the paid plan. Please try again.' }, { status: 500 })
  }

  await writeAudit(orgId, claims, 'billing.subscribe', `${seats} seat${seats === 1 ? '' : 's'}`)

  return NextResponse.json({
    ok:              true,
    seats,
    monthlyTotalZar: computeSeatCharge(seats as number).totalZar,
  })
}
