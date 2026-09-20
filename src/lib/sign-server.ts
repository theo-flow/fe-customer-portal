import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims, type JwtClaims } from '@/lib/token'
import type { SignSession } from '@/lib/sign'

// Server-only helpers shared by the org-authenticated Sign routes. Kept out
// of lib/sign.ts because that file is imported by client components.

export type OwnedSession =
  | { ok: true;  claims: JwtClaims; orgId: string; session: SignSession }
  | { ok: false; response: NextResponse }

const fail = (error: string, status: number): { ok: false; response: NextResponse } =>
  ({ ok: false, response: NextResponse.json({ error }, { status }) })

// Authenticates the caller, then loads a session only if it belongs to the
// caller's org. Ownership is checked through the ORG#/SESSION# pointer before
// the SESSION# item is ever read, and "not yours" returns the same 404 as
// "does not exist" so a session id can't be probed across orgs.
export async function loadOwnedSession(sessionId: string, logTag: string): Promise<OwnedSession> {
  const token = cookies().get('tf_token')?.value
  if (!token) return fail('Unauthorized', 401)

  const claims = await verifyJwtClaims(token)
  if (!claims) return fail('Unauthorized', 401)
  const orgId = claims['custom:org_id']
  if (!orgId) return fail('Forbidden', 403)

  const db = ddbDocClient()

  const pointer = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `SESSION#${sessionId}` },
  })).catch(err => {
    console.error(`[${logTag}] Pointer lookup failed`, { orgId, sessionId, error: err })
    return null
  })
  if (!pointer?.Item) return fail('Signing session not found', 404)

  try {
    const result = await db.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `SESSION#${sessionId}`, SK: 'SESSION' },
    }))
    if (!result.Item) return fail('Signing session not found', 404)
    return { ok: true, claims, orgId, session: result.Item as SignSession }
  } catch (err) {
    console.error(`[${logTag}] DynamoDB GetCommand failed`, { sessionId, error: err })
    return fail('Failed to load signing session', 500)
  }
}

export async function lookupOrgName(orgId: string): Promise<string | null> {
  try {
    const result = await ddbDocClient().send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `ORG#${orgId}`, SK: 'PROFILE' },
      ProjectionExpression: 'orgName',
    }))
    return (result.Item?.orgName as string | undefined) || null
  } catch (err) {
    console.error('[sign] Org name lookup failed', { orgId, error: err })
    return null
  }
}

// A real PDF starts with "%PDF-". Used to reject anything else before it is
// stamped application/pdf and sent to signers.
export function hasPdfHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
}

export function isConditionalCheckFailure(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'ConditionalCheckFailedException'
}
