import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient } from '@/lib/aws'
import { writeAudit } from '@/lib/audit'
import { requireOperatorClaims } from '@/lib/operator-guard'
import {
  MAX_REASON_LENGTH, MIN_REASON_LENGTH, assumeErasureClients, eraseWorkspace, inventory, isEmpty,
  isValidWorkspaceId, listErasures,
} from '@/lib/gate-keep-erasure'

// Operator-run erasure of one workspace's Gate-Keep data. Operator-only, and every
// erase is recorded (see lib/gate-keep-erasure.ts). The portal never deletes a
// workspace's files any other way.

type Ctx = { params: { orgId: string } }

const fail = (status: number, error: string, message: string) => NextResponse.json({ error, message }, { status })

// What an erasure would remove, plus the history of past ones. Changes nothing.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireOperatorClaims()
  if (auth instanceof NextResponse) return auth
  if (!isValidWorkspaceId(params.orgId)) return fail(400, 'invalid_workspace', 'That workspace id is not valid.')

  try {
    const clients = await assumeErasureClients(params.orgId, auth.email)
    const [current, history] = await Promise.all([
      inventory(clients, params.orgId),
      listErasures(ddbDocClient(), params.orgId),
    ])
    return NextResponse.json({ inventory: current, history })
  } catch (err) {
    console.error('[operator/gate-keep] Inventory failed', { orgId: params.orgId, error: err })
    return fail(500, 'server_error', 'Something went wrong. Please try again.')
  }
}

// Erases everything. Needs the workspace id typed back and a reason (a request or ticket
// reference), so it cannot happen by a stray click. Safe to repeat: a run that ran out of
// time reports complete=false and is simply run again.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireOperatorClaims()
  if (auth instanceof NextResponse) return auth
  const { orgId } = params
  if (!isValidWorkspaceId(orgId)) return fail(400, 'invalid_workspace', 'That workspace id is not valid.')

  const body = await req.json().catch(() => null) as { confirmOrgId?: unknown; reason?: unknown } | null
  if (!body || typeof body !== 'object') return fail(400, 'bad_request', 'Invalid request body.')
  if (body.confirmOrgId !== orgId) return fail(400, 'confirmation_mismatch', 'The workspace id typed does not match.')

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < MIN_REASON_LENGTH) {
    return fail(400, 'reason_required', `Give a reason of at least ${MIN_REASON_LENGTH} characters (a request or ticket reference).`)
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return fail(400, 'reason_too_long', `The reason can be at most ${MAX_REASON_LENGTH} characters.`)
  }

  try {
    const clients = await assumeErasureClients(orgId, auth.email)
    if (isEmpty(await inventory(clients, orgId))) {
      return fail(409, 'nothing_to_erase', 'There is no Gate-Keep data for this workspace.')
    }

    const result = await eraseWorkspace(clients, { ws: orgId, operatorSub: auth.sub, operatorEmail: auth.email, reason })
    await writeAudit(orgId, auth, 'gate_keep.erased', result.complete ? 'complete' : 'partial')
    return NextResponse.json({ result })
  } catch (err) {
    console.error('[operator/gate-keep] Erasure failed', { orgId, operator: auth.email, error: err })
    return fail(500, 'server_error', 'The erasure did not finish. Check the erasure log for what was done, then run it again.')
  }
}
