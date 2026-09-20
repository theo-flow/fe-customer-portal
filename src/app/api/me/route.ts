import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { verifyJwtClaims, initialsFromName } from '@/lib/token'
import { roleOf } from '@/lib/roles'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { orgAccess, productsFor, type OrgAccess } from '@/lib/org-access'

export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims   = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const name     = claims.name ?? ''
  const email    = claims.email ?? ''
  const orgId    = claims['custom:org_id'] ?? ''
  const initials = initialsFromName(name, email)

  // Fetch the org profile for its name and form groups, and its access state
  // (pilot, paid or locked), which decides the products it can use.
  let orgName = ''
  let formGroups: { group: string; groupLabel: string }[] = []
  let access: OrgAccess | null = null

  if (orgId) {
    try {
      const [result, orgAccessState] = await Promise.all([
        ddbDocClient().send(new GetCommand({
          TableName: TABLE,
          Key: { PK: `ORG#${orgId}`, SK: 'PROFILE' },
          ProjectionExpression: 'orgName, form_groups',
        })),
        orgAccess(orgId),
      ])
      access = orgAccessState
      if (result.Item) {
        orgName    = result.Item.orgName    ?? ''
        formGroups = result.Item.form_groups ?? []
      }
    } catch {
      // Non-fatal: portal still loads, product tiles will show empty state
    }
  }

  // A pilot and a paid org both get every product; a locked org gets none.
  // If the lookup failed, fall back to "active" rather than locking someone out
  // over a transient error.
  const state = access?.state ?? 'active'

  return NextResponse.json({
    name, email, orgId, orgName, initials, role: roleOf(claims),
    subscribedProducts: productsFor({ state }),
    formGroups,
    access: { state, daysLeft: access?.daysLeft ?? null, trialEndsAt: access?.trialEndsAt ?? null },
  })
}
