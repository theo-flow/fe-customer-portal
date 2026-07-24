import { CognitoJwtVerifier } from 'aws-jwt-verify'

export interface JwtClaims {
  sub:             string
  email:           string
  name?:           string
  'custom:org_id'?: string
  exp:             number
}

// Buffer.from(..., 'base64url') doesn't exist in the browser (Buffer is a
// Node-only global, not polyfilled here) -- this needs to run identically
// client-side (SessionWatcher) and server-side (API routes), so it decodes
// with atob + TextDecoder, which both environments provide. atob() alone
// (as middleware.ts's separate inline decoder uses) mangles multi-byte
// UTF-8 in name/email; TextDecoder reassembles it correctly.
//
// IMPORTANT: this only decodes the payload -- it does NOT verify the
// token's signature. Safe for non-security-critical, client-side-only
// reads (e.g. SessionWatcher showing a name/expiry countdown). Any
// server-side authorization decision (every API route) MUST use
// verifyJwtClaims() below instead, or the "email"/"custom:org_id" claims
// can be forged by anyone who sets their own tf_token cookie to an
// unsigned, self-crafted value -- nothing before this checked that.
export function decodeJwtClaims(token: string): JwtClaims {
  try {
    const [, payload] = token.split('.')
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const bytes  = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    return JSON.parse(new TextDecoder('utf-8').decode(bytes)) as JwtClaims
  } catch {
    return { sub: '', email: '', exp: 0 }
  }
}

// Real, cryptographic verification against the Cognito user pool's JWKS --
// use this (never decodeJwtClaims) wherever a claim drives an
// authorization decision. The verifier caches the JWKS after first fetch,
// so this is cheap on repeated calls within the same Lambda instance.
// Built lazily (not at module load) -- SessionWatcher.tsx imports this same
// module client-side for decodeJwtClaims only, and eagerly constructing the
// verifier would throw there (and in any test importing this file) whenever
// the Cognito env vars aren't set, even though it's never called.
let _verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null
function getVerifier() {
  if (!_verifier) {
    _verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
      tokenUse:   'id',
      clientId:   process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
    })
  }
  return _verifier
}

export async function verifyJwtClaims(token: string): Promise<JwtClaims | null> {
  try {
    const payload = await getVerifier().verify(token)
    return payload as unknown as JwtClaims
  } catch {
    return null
  }
}

export function initialsFromName(name: string | undefined, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/)
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}
