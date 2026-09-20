import { NextRequest, NextResponse } from 'next/server'
import type { S3Client } from '@aws-sdk/client-s3'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { JwtClaims } from '@/lib/token'
import { getGateKeepContext } from '@/lib/gate-keep-context'
import { getScopedClients } from '@/lib/gate-keep-credentials'
import { NameTakenError, StaleItemError } from '@/lib/gate-keep-store'

// The shared shell of every Gate-Keep route: require a valid login, build the
// caller's scoped S3 + catalogue clients from ONE credential exchange, and turn
// known failures into consistent JSON errors. Handlers only ever see the
// workspace that came from the verified token.

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message?: string) {
    super(message ?? code)
  }
}

export const notFound = () => new HttpError(404, 'not_found', 'Not found.')

export interface GkContext {
  ws:     string
  userId: string
  claims: JwtClaims
  s3:     S3Client
  db:     DynamoDBDocumentClient
}

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ error: code, message }, { status })

export async function gateKeep(
  label: string,
  handler: (c: GkContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  const ctx = await getGateKeepContext()
  if (!ctx) return fail(401, 'unauthorized', 'Please sign in again.')

  try {
    const { s3, db } = await getScopedClients(ctx.token)
    return await handler({ ws: ctx.orgId, userId: ctx.userId, claims: ctx.claims, s3, db })
  } catch (err) {
    if (err instanceof HttpError)      return fail(err.status, err.code, err.message)
    if (err instanceof NameTakenError) return fail(409, 'name_taken', err.message)
    if (err instanceof StaleItemError) return fail(409, 'stale', err.message)
    console.error(`[gate-keep/${label}] Request failed`, { orgId: ctx.orgId, userId: ctx.userId, error: err })
    return fail(500, 'server_error', 'Something went wrong. Please try again.')
  }
}

export async function readJson<T extends object>(req: NextRequest): Promise<Partial<T>> {
  try {
    const body = await req.json()
    if (body && typeof body === 'object') return body as Partial<T>
  } catch { /* falls through */ }
  throw new HttpError(400, 'bad_request', 'Invalid request body.')
}
