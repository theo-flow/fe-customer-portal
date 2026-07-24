import { randomUUID } from 'crypto'
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { generateToken, hashToken } from '@/lib/sign'
import { tokenExpiryIso, type RecipientLink } from '@/lib/recipients'

export async function GET(
  _req: NextRequest,
  { params }: { params: { group: string } },
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { group } = params

  const result = await ddbDocClient().send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': `RECIPIENT#${group}#` },
    ScanIndexForward:          false,
  }))

  const recipients = (result.Items ?? []).map(item => ({
    recipientId: item.recipient_id as string,
    name:        item.name         as string,
    email:       (item.email as string) ?? null,
    status:      item.status       as string,
    createdAt:   item.created_at   as string,
    updatedAt:   item.updated_at   as string,
  }))

  return NextResponse.json({ recipients })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { group: string } },
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { group } = params

  let body: { name?: string; email?: string }
  try {
    body = await req.json()
  } catch (err) {
    console.error('[recipients] Failed to parse request body', { error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const name  = body.name?.trim()
  const email = body.email?.trim() || null
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })

  const db = ddbDocClient()

  const pointer = await db.send(new GetCommand({
    TableName: TABLE,
    Key:       { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}` },
  }))
  if (!pointer.Item || pointer.Item.published_version == null) {
    return NextResponse.json({ error: 'This form is not published yet' }, { status: 400 })
  }
  const groupLabel = pointer.Item.group_label as string

  const recipientId = randomUUID()
  const rawToken     = generateToken()
  const now          = new Date().toISOString()

  const item: RecipientLink = {
    recipient_id:    recipientId,
    group,
    group_label:     groupLabel,
    name,
    email,
    token_hash:       hashToken(rawToken),
    token_expires_at: tokenExpiryIso(),
    status:           'PENDING',
    submission_id:    null,
    created_at:       now,
    updated_at:       now,
  }

  await db.send(new PutCommand({
    TableName: TABLE,
    Item:      { PK: `ORG#${orgId}`, SK: `RECIPIENT#${group}#${recipientId}`, ...item },
  }))

  // req.nextUrl.origin is unreliable inside the OpenNext/Lambda runtime
  // (resolves to localhost:3000) -- same fix already applied for Sign links.
  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin

  return NextResponse.json({
    recipientId,
    name,
    fillUrl: `${origin}/fill/${orgId}/${group}/${recipientId}/${rawToken}`,
  })
}
