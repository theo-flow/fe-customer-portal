import { cookies } from 'next/headers'
import { verifyJwtClaims, type JwtClaims } from '@/lib/token'

export interface GateKeepContext {
  token:  string
  orgId:  string
  userId: string
  claims: JwtClaims
}

// Same identity derivation the existing gate-keep routes inline: orgId falls
// back to the user's sub for an account with no custom:org_id yet, so its
// files still live under a stable, per-user prefix.
export async function getGateKeepContext(): Promise<GateKeepContext | null> {
  const token = cookies().get('tf_token')?.value
  if (!token) return null

  const claims = await verifyJwtClaims(token)
  if (!claims) return null

  return { token, orgId: claims['custom:org_id'] ?? claims.sub, userId: claims.sub, claims }
}
