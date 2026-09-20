import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyJwtClaims } from '@/lib/token'
import { isAdmin } from '@/lib/roles'
import { orgAccess } from '@/lib/org-access'
import { PLANS, TRIAL_DAYS } from '@/lib/plans'
import { DOCS_PER_SEAT, computeSeatCharge, seatBandRows } from '@/lib/seat-pricing'

// What the "Choose your seats" screen needs: where the org stands (pilot, paid or
// locked), the price bands, and what it pays now. Read-only; starting the paid
// plan is POST /api/billing/subscribe, changing seats is POST /api/team/seats.
export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const access = await orgAccess(orgId)
  const paid   = access.state === 'active'

  return NextResponse.json({
    state:           access.state,
    trialDays:       TRIAL_DAYS,
    trialEndsAt:     access.trialEndsAt,
    daysLeft:        access.daysLeft,
    seats:           paid ? access.seats : 1,
    monthlyTotalZar: paid ? computeSeatCharge(access.seats).totalZar : 0,
    canManage:       isAdmin(claims),
    bands:           seatBandRows(),
    docsPerSeat:     DOCS_PER_SEAT,
    overageRateZar:  PLANS.starter.overageRateZar,
  })
}
