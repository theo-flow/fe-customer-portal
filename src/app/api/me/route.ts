import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { decodeJwtClaims, initialsFromName } from '@/lib/token'

export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims   = decodeJwtClaims(token)
  const name     = claims.name ?? ''
  const email    = claims.email ?? ''
  const orgId    = claims['custom:org_id'] ?? ''
  const initials = initialsFromName(name, email)

  return NextResponse.json({ name, email, orgId, initials })
}
