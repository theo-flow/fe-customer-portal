import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, CONTACT_TABLE } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'
import { isOperatorEmail } from '@/lib/operator'

const VALID_STATUSES = new Set(['new', 'contacted', 'converted'])

// Platform-wide, not org-scoped -- these are Sithembiso's own sales leads,
// not any org's data. Gated by an operator-email allowlist (see
// src/lib/operator.ts), not custom:org_id -- an org-scoped gate here would
// let any authenticated org admin see every other prospect's contact
// details, a real cross-tenant leak.
function requireOperator(): { email: string } | NextResponse {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  if (!isOperatorEmail(claims.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { email: claims.email }
}

export async function GET() {
  const auth = requireOperator()
  if (auth instanceof NextResponse) return auth

  const result = await ddbDocClient().send(new ScanCommand({
    TableName: CONTACT_TABLE,
  })).catch(err => {
    console.error('[admin/leads] Scan failed', err)
    return null
  })

  if (!result) {
    return NextResponse.json({ error: 'Failed to load leads' }, { status: 500 })
  }

  const items = (result.Items ?? [])
    .map(item => ({
      messageId: item.messageId as string,
      name:      item.name as string,
      email:     item.email as string,
      org:       item.org as string,
      message:   item.message as string,
      status:    (item.status ?? 'new') as string,
      createdAt: item.createdAt as string,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return NextResponse.json({ items })
}

export async function PATCH(req: NextRequest) {
  const auth = requireOperator()
  if (auth instanceof NextResponse) return auth

  const { messageId, status } = await req.json() as { messageId?: string; status?: string }

  if (!messageId?.trim()) {
    return NextResponse.json({ error: 'messageId is required' }, { status: 400 })
  }
  if (!status || !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: `status must be one of: ${Array.from(VALID_STATUSES).join(', ')}` }, { status: 400 })
  }

  await ddbDocClient().send(new UpdateCommand({
    TableName: CONTACT_TABLE,
    Key: { PK: `MESSAGE#${messageId}`, SK: 'PROFILE' },
    UpdateExpression: 'SET #st = :s',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':s': status },
  })).catch(err => {
    console.error('[admin/leads] Update failed', { messageId, error: err })
    throw err
  })

  return NextResponse.json({ ok: true })
}
