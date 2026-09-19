import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims, type JwtClaims } from '@/lib/token'
import { isOperatorEmail } from '@/lib/operator'
import { isReadType } from '@/lib/sign-form'
import type { FormField } from '@/lib/sign-form'

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
export const suggestionKey = (orgId: string, formId: string) => ({ PK: `ORG#${orgId}`, SK: `SIGNSUGG#${formId}` })
export const sampleKey  = (orgId: string, formId: string) => `sign/forms/${orgId}/${formId}/sample.pdf`

export function isTransactionConflict(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return name === 'TransactionCanceledException' || name === 'ConditionalCheckFailedException'
}

// Where on the form the recipient's details are printed, in the shape the send
// screen needs. Kept on the pointer so listing a customer's forms is one query.
// (Named read_boxes: "reads" is a DynamoDB reserved word.)
export function readBoxes(fields: FormField[]) {
  return fields.filter(f => isReadType(f.field_type)).map(f => ({
    role: f.role, kind: f.field_type === 'read_name' ? 'name' : 'email',
    page: f.page, x: f.x, y: f.y, width: f.width, height: f.height,
  }))
}

// The pointer and the current version of one form, or null if it does not
// exist or has been archived.
export async function loadCurrentForm(orgId: string, formId: string) {
  const db = ddbDocClient()
  const pointer = await db.send(new GetCommand({ TableName: TABLE, Key: pointerKey(orgId, formId) }))
  if (!pointer.Item || pointer.Item.form_status === 'ARCHIVED') return null
  const version = await db.send(new GetCommand({
    TableName: TABLE, Key: versionKey(orgId, formId, pointer.Item.current_version as number),
  }))
  if (!version.Item) return null
  return { pointer: pointer.Item, version: version.Item }
}

// Two page sizes count as the same when they are within 2% (the same tolerance
// the send screen uses to recognise a form), so a blank copy of a form made by a
// different PDF tool still lines up.
const SIZE_TOLERANCE = 0.02
export const sameSize = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * SIZE_TOLERANCE
