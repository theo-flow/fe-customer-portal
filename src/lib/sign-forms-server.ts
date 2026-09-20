import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims, type JwtClaims } from '@/lib/token'
import { isOperatorEmail } from '@/lib/operator'

// Server-only helpers for the operator's Sign form configuration routes.
//
// Storage (all in the orgs table, under the customer's own partition):
//   ORG#{orgId} / SIGNFORM#{formId}          pointer: name, current_version, roles, ...
//   ORG#{orgId} / SIGNFORMV#{formId}#{0001}  one immutable item per saved version
// Versions use a different prefix (SIGNFORMV#, not SIGNFORM#...) so that
// listing a customer's forms with begins_with SIGNFORM# returns only the
// pointers. The pointer deliberately has NO attribute called "status": the
// orgs table's sparse status-index is keyed on it, and Forge schemas and
// Sign sessions already share that index (see docs/technical-debt-register.md).
// It uses form_status instead.

export type OperatorAuth =
  | { ok: true;  claims: JwtClaims }
  | { ok: false; response: NextResponse }

export async function requireOperator(): Promise<OperatorAuth> {
  const token = cookies().get('tf_token')?.value
  if (!token) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const claims = await verifyJwtClaims(token)
  if (!claims) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isOperatorEmail(claims.email)) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, claims }
}

// Ids arrive in the URL and end up in DynamoDB sort keys and S3 keys, so only
// a conservative character set is accepted.
export const isSafeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)

export async function orgExists(orgId: string): Promise<boolean> {
  const res = await ddbDocClient().send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `ORG#${orgId}`, SK: 'PROFILE' },
    ProjectionExpression: 'orgId',
  })).catch(() => null)
  return !!res?.Item
}

export const pointerKey = (orgId: string, formId: string) => ({ PK: `ORG#${orgId}`, SK: `SIGNFORM#${formId}` })
export const versionKey = (orgId: string, formId: string, version: number) =>
  ({ PK: `ORG#${orgId}`, SK: `SIGNFORMV#${formId}#${String(version).padStart(4, '0')}` })
export const sampleKey  = (orgId: string, formId: string) => `sign/forms/${orgId}/${formId}/sample.pdf`

export function isTransactionConflict(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return name === 'TransactionCanceledException' || name === 'ConditionalCheckFailedException'
}
