import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { writeAudit } from '@/lib/audit'
import { requireOperatorClaims } from '@/lib/operator-guard'
import { isEolYears } from '@/lib/gate-keep-eol'

const VALID_PRODUCTS = new Set(['forge', 'channel', 'harvest', 'decode', 'sign', 'print'])

// What an operator may change about an organisation: the products it has, and the end-of-life
// period agreed with it for its Gate-Keep files (5, 6 or 7 years, or null for none).
// The period applies to files added from then on; files already stored are not affected.
export async function PATCH(req: NextRequest, { params }: { params: { orgId: string } }) {
  const auth = await requireOperatorClaims()
  if (auth instanceof NextResponse) return auth

  const { orgId } = params
  const body = await req.json() as { subscribedProducts?: string[]; retentionYears?: number | null }
  const hasProducts = body.subscribedProducts !== undefined
  const hasPeriod   = 'retentionYears' in body

  if (!hasProducts && !hasPeriod) {
    return NextResponse.json({ error: 'subscribedProducts must be an array' }, { status: 400 })
  }
  if (hasProducts) {
    if (!Array.isArray(body.subscribedProducts)) {
      return NextResponse.json({ error: 'subscribedProducts must be an array' }, { status: 400 })
    }
    const invalidProduct = body.subscribedProducts.find(p => !VALID_PRODUCTS.has(p))
    if (invalidProduct) {
      return NextResponse.json({ error: `Unknown product: ${invalidProduct}` }, { status: 400 })
    }
  }
  if (hasPeriod && body.retentionYears !== null && !isEolYears(body.retentionYears)) {
    return NextResponse.json({ error: 'retentionYears must be 5, 6, 7 or null' }, { status: 400 })
  }

  const sets: string[] = []
  const values: Record<string, unknown> = {}
  if (hasProducts) { sets.push('subscribed_products = :p'); values[':p'] = body.subscribedProducts }
  if (hasPeriod && body.retentionYears !== null) { sets.push('retention_years = :y'); values[':y'] = body.retentionYears }
  const remove = hasPeriod && body.retentionYears === null ? ' REMOVE retention_years' : ''

  try {
    await ddbDocClient().send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `ORG#${orgId}`, SK: 'PROFILE' },
      UpdateExpression: (sets.length ? `SET ${sets.join(', ')}` : '') + remove,
      ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
      // Without this an update to an unknown org ID would quietly create a
      // stray PROFILE item.
      ConditionExpression: 'attribute_exists(PK)',
    }))
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return NextResponse.json({ error: 'Org not found' }, { status: 404 })
    }
    console.error('[operator/orgs/:orgId] Update failed', { orgId, error: err })
    throw err
  }

  if (hasPeriod) await writeAudit(orgId, auth, 'gate_keep.eol_set', body.retentionYears ? `${body.retentionYears} years` : 'none')
  return NextResponse.json({ ok: true })
}
