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

export function initialsFromName(name: string | undefined, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/)
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}
