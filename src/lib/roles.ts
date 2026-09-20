import { NextResponse } from 'next/server'
import type { JwtClaims } from '@/lib/token'

export type Role = 'admin' | 'agent'

// The role comes from fn-21's PreTokenGeneration trigger, which reads it from
// the DynamoDB membership record. A token without the claim (the trigger isn't
// deployed, or an old token) gets the least-privileged role, so a missing
// claim can never grant admin access.
export function roleOf(claims: Pick<JwtClaims, 'custom:role'>): Role {
  return claims['custom:role'] === 'admin' ? 'admin' : 'agent'
}

export function isAdmin(claims: Pick<JwtClaims, 'custom:role'>): boolean {
  return roleOf(claims) === 'admin'
}

// For admin-only routes, after the token has been verified:
//   const denied = forbiddenUnlessAdmin(claims); if (denied) return denied
export function forbiddenUnlessAdmin(claims: Pick<JwtClaims, 'custom:role'>): NextResponse | null {
  return isAdmin(claims)
    ? null
    : NextResponse.json({ error: 'Admin access required' }, { status: 403 })
}
