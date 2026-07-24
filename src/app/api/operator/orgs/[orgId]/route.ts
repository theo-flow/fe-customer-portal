import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { isOperatorEmail } from '@/lib/operator'

const VALID_PRODUCTS = new Set(['forge', 'channel', 'harvest', 'decode', 'sign', 'print'])

async function requireOperator(): Promise<{ email: string } | NextResponse> {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOperatorEmail(claims.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { email: claims.email }
}

// The one write action on top of Phase 5's otherwise read-only operator
// console -- lets an operator turn products on for an org after signup,
// now that registration no longer collects product selection up front.
export async function PATCH(req: NextRequest, { params }: { params: { orgId: string } }) {
  const auth = await requireOperator()
  if (auth instanceof NextResponse) return auth

  const { orgId } = params
  const { subscribedProducts } = await req.json() as { subscribedProducts?: string[] }

  if (!Array.isArray(subscribedProducts)) {
    return NextResponse.json({ error: 'subscribedProducts must be an array' }, { status: 400 })
  }
  const invalidProduct = subscribedProducts.find(p => !VALID_PRODUCTS.has(p))
  if (invalidProduct) {
    return NextResponse.json({ error: `Unknown product: ${invalidProduct}` }, { status: 400 })
  }

  await ddbDocClient().send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `ORG#${orgId}`, SK: 'PROFILE' },
    UpdateExpression: 'SET subscribed_products = :p',
    ExpressionAttributeValues: { ':p': subscribedProducts },
  })).catch(err => {
    console.error('[operator/orgs/:orgId] Update failed', { orgId, error: err })
    throw err
  })

  return NextResponse.json({ ok: true })
}
