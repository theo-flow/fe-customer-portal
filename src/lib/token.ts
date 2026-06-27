export interface JwtClaims {
  sub:             string
  email:           string
  name?:           string
  'custom:org_id'?: string
  exp:             number
}

export function decodeJwtClaims(token: string): JwtClaims {
  try {
    const [, payload] = token.split('.')
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as JwtClaims
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
