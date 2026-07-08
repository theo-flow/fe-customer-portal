import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'

export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await ddbDocClient().send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'SCHEMA#' },
  }))

  // SK is either the pointer (SCHEMA#{group}) or an immutable version item
  // (SCHEMA#{group}#v{n}) -- only pointers belong in the forms list.
  const pointers = (result.Items ?? []).filter(item => (item.SK as string).split('#').length === 2)

  const forms = pointers.map(item => {
    const publishedVersion = (item.published_version as number) ?? null
    // The pointer only ever legitimately reaches READY via an explicit publish
    // action (see api/forms/[group]/publish/route.ts), which always sets
    // published_version together with status. Deriving status from
    // published_version's presence -- rather than trusting a stored status
    // string -- means stale pre-Module-7 values (ANALYZING/ERROR) left on
    // never-republished pointers can never leak through as a false "Error".
    return {
      group:            item.group       as string,
      groupLabel:       item.group_label as string,
      status:           publishedVersion != null ? 'READY' : 'DRAFT',
      fieldCount:       (item.fields as unknown[])?.length ?? 0,
      updatedAt:        item.updated_at  as string,
      latestVersion:    (item.latest_version as number) ?? 0,
      publishedVersion,
    }
  })

  return NextResponse.json({ forms })
}
