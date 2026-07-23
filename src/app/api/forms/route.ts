import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
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

  // The pointer's own `status` attribute is stale/untrustworthy (pre-Module-7
  // values could leak through as a false "Error" on a never-republished
  // pointer), which is why status used to be derived from published_version
  // alone -- but that made a failed digitization show as "not yet published"
  // instead of an actual error, and never surfaced ANALYZING at all. Reading
  // each pointer's *latest version item* (immutable, written once by fn-00)
  // gives a real status without trusting the mutable pointer attribute.
  const latestVersions = await Promise.all(pointers.map(item => {
    const v = (item.latest_version as number) ?? 0
    return v === 0 ? Promise.resolve(null) : ddbDocClient().send(new GetCommand({
      TableName: TABLE,
      Key:       { PK: `ORG#${orgId}`, SK: `SCHEMA#${item.group}#v${v}` },
    }))
  }))

  const forms = pointers.map((item, i) => {
    const publishedVersion = (item.published_version as number) ?? null
    const latest = latestVersions[i]?.Item
    // READY still comes only from an explicit publish action (see
    // api/forms/[group]/publish/route.ts) -- an unpublished-but-successfully-
    // analysed latest version must not be treated as READY, since isReady
    // gates the Preview/share-link affordances on actual publish state.
    const status = publishedVersion != null                ? 'READY'
                  : latest?.status === 'ANALYZING'          ? 'ANALYZING'
                  : latest?.status === 'ERROR'               ? 'ERROR'
                  :                                            'DRAFT'
    return {
      group:            item.group       as string,
      groupLabel:       item.group_label as string,
      status,
      fieldCount:       (item.fields as unknown[])?.length ?? 0,
      updatedAt:        item.updated_at  as string,
      latestVersion:    (item.latest_version as number) ?? 0,
      publishedVersion,
      errorMessage:     status === 'ERROR'     ? ((latest?.error_message    as string) ?? null) : null,
      processingStage:  status === 'ANALYZING' ? ((latest?.processing_stage as string) ?? null) : null,
    }
  })

  return NextResponse.json({ forms })
}
