import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'
import type { ForgeStatus } from '@/lib/forms-types'

export async function GET(
  _req: Request,
  { params }: { params: { group: string } },
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = ddbDocClient()
  const { group } = params

  let pointer, versionItems
  try {
    [pointer, versionItems] = await Promise.all([
      db.send(new GetCommand({
        TableName: TABLE,
        Key:       { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}` },
      })),
      db.send(new QueryCommand({
        TableName:                 TABLE,
        KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': `SCHEMA#${group}#v` },
      })),
    ])
  } catch (err) {
    console.error('[versions] DynamoDB read failed', { orgId, group, error: err })
    return NextResponse.json({ error: 'Failed to load versions' }, { status: 500 })
  }

  const publishedVersion = (pointer.Item?.published_version as number) ?? null
  const latestVersion    = (pointer.Item?.latest_version as number) ?? 0

  const versions = (versionItems.Items ?? [])
    .map(item => ({
      version:         item.version         as number,
      status:          item.status          as ForgeStatus,
      processingStage: (item.processing_stage as string) ?? null,
      errorMessage:    (item.error_message    as string) ?? null,
      fieldCount:      (item.fields as unknown[])?.length ?? 0,
      reviewNoteCount: (item.review_notes as unknown[])?.length ?? 0,
      brandingSource:  (item.branding as { source?: string } | undefined)?.source ?? null,
      createdAt:       item.created_at      as string,
      updatedAt:       item.updated_at      as string,
      sourceS3Key:     item.source_s3_key   as string,
      published:       item.version === publishedVersion,
    }))
    .sort((a, b) => b.version - a.version)

  return NextResponse.json({ publishedVersion, latestVersion, versions })
}
