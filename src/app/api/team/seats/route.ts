import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { forbiddenUnlessAdmin } from '@/lib/roles'
import { computeSeatCharge, MAX_SEATS } from '@/lib/seat-pricing'
import { loadTeam, seatAllowance, seatsUsed } from '@/lib/team'
import { writeAudit } from '@/lib/audit'

// Sets how many seats the org has, priced by position. Admin only, paid plan
// only (a pilot has one seat and starts the paid plan instead). Takes effect
// immediately; the next invoice bills the new count, with no proration.
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
    return NextResponse.json({ error: `Enter a whole number of seats from 1 to ${MAX_SEATS}.` }, { status: 400 })
  }

  const [members, allowance] = await Promise.all([loadTeam(orgId, claims), seatAllowance(orgId)])

  if (!allowance.canChangeSeats) {
    return NextResponse.json({ error: 'Start the paid plan to add seats.' }, { status: 409 })
  }

  // Never strand people who already hold a seat: remove them first.
  const needed = seatsUsed(members)
  if ((seats as number) < needed) {
    return NextResponse.json(
      { error: `You have ${needed} people on your team. Remove someone before dropping below that.` },
      { status: 409 },
    )
  }

  await ddbDocClient().send(new UpdateCommand({
    TableName:                 TABLE,
    Key:                       { PK: `ORG#${orgId}`, SK: 'PROFILE' },
    UpdateExpression:          'SET seats = :n',
    ConditionExpression:       'attribute_exists(PK)',
    ExpressionAttributeValues: { ':n': seats },
  }))

  await writeAudit(orgId, claims, 'team.seats', `${seats} seat${seats === 1 ? '' : 's'}`)

  return NextResponse.json({
    ok:              true,
    seats,
    monthlyTotalZar: computeSeatCharge(seats as number).totalZar,
  })
}
