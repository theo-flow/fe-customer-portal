import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyJwtClaims, type JwtClaims } from '@/lib/token'
import { isOperatorEmail } from '@/lib/operator'

// The operator gate for routes that need who the operator is (to attribute an audited
// action), not just that they are one. Same allowlist as the rest of the operator console.
export async function requireOperatorClaims(): Promise<JwtClaims | NextResponse> {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOperatorEmail(claims.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return claims
}
