import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'

// Authenticated fetch of one specific (possibly unpublished) forged version --
// distinct from the public /fill route, which only ever serves the
// org's currently *published* pointer. Used to preview a version before
// deciding to publish it.
export async function GET(
  _req: Request,
  { params }: { params: { group: string; version: string } },
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { group, version } = params

  const result = await ddbDocClient().send(new GetCommand({
    TableName: TABLE,
    Key:       { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}#v${version}` },
  }))

  if (!result.Item) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  if (result.Item.status !== 'READY' && result.Item.status !== 'NEEDS_REVIEW') {
    return NextResponse.json({ error: `Version ${version} is not ready to preview (status: ${result.Item.status})` }, { status: 400 })
  }

  return NextResponse.json({
    version:      result.Item.version,
    groupLabel:   result.Item.group_label,
    status:       result.Item.status,
    fields:       result.Item.fields ?? [],
    reviewNotes:  result.Item.review_notes ?? [],
    branding:     result.Item.branding ?? null,
    sourceS3Key:  result.Item.source_s3_key ?? null,
  })
}
