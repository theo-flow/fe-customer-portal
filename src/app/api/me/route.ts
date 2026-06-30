import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { decodeJwtClaims, initialsFromName } from '@/lib/token'
import { ddbDocClient, TABLE } from '@/lib/aws'

export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims   = decodeJwtClaims(token)
  const name     = claims.name ?? ''
  const email    = claims.email ?? ''
  const orgId    = claims['custom:org_id'] ?? ''
  const initials = initialsFromName(name, email)

  // Fetch org profile to get product subscriptions and form groups
  let orgName            = ''
  let subscribedProducts: string[]                         = []
  let formGroups:         { group: string; groupLabel: string }[] = []

  if (orgId) {
    try {
      const result = await ddbDocClient().send(new GetCommand({
        TableName: TABLE,
        Key: { PK: `ORG#${orgId}`, SK: 'PROFILE' },
        ProjectionExpression: 'orgName, subscribed_products, form_groups',
      }))
      if (result.Item) {
        orgName            = result.Item.orgName            ?? ''
        subscribedProducts = result.Item.subscribed_products ?? []
        formGroups         = result.Item.form_groups         ?? []
      }
    } catch {
      // Non-fatal: portal still loads, product tiles will show empty state
    }
  }

  return NextResponse.json({ name, email, orgId, orgName, initials, subscribedProducts, formGroups })
}
