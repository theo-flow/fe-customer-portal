import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyJwtClaims } from '@/lib/token'
import { forbiddenUnlessAdmin } from '@/lib/roles'
import { loadTeam, seatAllowance, seatsUsed } from '@/lib/team'

export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = forbiddenUnlessAdmin(claims)
  if (denied) return denied

  const [members, seats] = await Promise.all([loadTeam(orgId, claims), seatAllowance(orgId)])

  return NextResponse.json({
    members:   members.filter(m => m.status !== 'removed'),
    seatsUsed: seatsUsed(members),
    seats,
  })
}
