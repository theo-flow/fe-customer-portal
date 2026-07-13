import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'

export async function POST(
  req: NextRequest,
  { params }: { params: { group: string } },
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { group } = params

  let body: { version?: number }
  try {
    body = await req.json()
  } catch (err) {
    console.error('[publish] Failed to parse request body', { error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { version } = body
  if (!version || typeof version !== 'number') {
    return NextResponse.json({ error: 'Missing version' }, { status: 400 })
  }

  const db = ddbDocClient()

  let target
  try {
    target = await db.send(new GetCommand({
      TableName: TABLE,
      Key:       { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}#v${version}` },
    }))
  } catch (err) {
    console.error('[publish] DynamoDB GetCommand failed', { orgId, group, version, error: err })
    return NextResponse.json({ error: 'Failed to load version' }, { status: 500 })
  }

  if (!target.Item) {
    return NextResponse.json({ error: 'Version not found' }, { status: 400 })
  }
  if (target.Item.status !== 'READY') {
    return NextResponse.json({ error: `Version ${version} is not READY (status: ${target.Item.status})` }, { status: 400 })
  }

  const now = new Date().toISOString()

  try {
    await db.send(new UpdateCommand({
      TableName: TABLE,
      Key:       { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}` },
      UpdateExpression: [
        'SET published_version = :version',
        '#st = :status',
        '#fld = :fields',
        'group_label = :groupLabel',
        'branding = :branding',
        'source_s3_key = :sourceKey',
        'updated_at = :now',
        'published_at = :now',
      ].join(', '),
      ExpressionAttributeNames: {
        '#st':  'status', // "status" is a DynamoDB reserved keyword -- must be aliased
        '#fld': 'fields', // "fields" is also a DynamoDB reserved keyword -- must be aliased
      },
      ExpressionAttributeValues: {
        ':version':     version,
        ':status':      'READY',
        ':fields':      target.Item.fields ?? [],
        ':groupLabel':  target.Item.group_label,
        ':branding':    target.Item.branding ?? null,
        ':sourceKey':   target.Item.source_s3_key,
        ':now':         now,
      },
    }))
  } catch (err) {
    console.error('[publish] DynamoDB UpdateCommand failed', { orgId, group, version, error: err })
    return NextResponse.json({ error: 'Failed to publish version' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, publishedVersion: version })
}
