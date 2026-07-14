import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'

// Adds one form group to an already-registered org. Registration only ever
// writes form_groups once, at signup -- there was previously no way for an
// org to add a document type afterward without re-registering.
const SLUG_RE = /^[a-z][a-z0-9_-]{1,49}$/

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50)
}

export async function POST(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { group?: string; groupLabel?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const groupLabel = body.groupLabel?.trim()
  if (!groupLabel) {
    return NextResponse.json({ error: 'groupLabel is required' }, { status: 400 })
  }
  // A caller can pass a known picklist key (body.group) directly, or omit it
  // for a custom group, in which case the slug is derived from the label.
  const group = body.group?.trim() || slugify(groupLabel)
  if (!SLUG_RE.test(group)) {
    return NextResponse.json({ error: 'Could not derive a valid group identifier from that name' }, { status: 400 })
  }

  const db = ddbDocClient()

  const profile = await db.send(new GetCommand({
    TableName: TABLE,
    Key:       { PK: `ORG#${orgId}`, SK: 'PROFILE' },
  }))
  if (!profile.Item) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })

  const existing = (profile.Item.form_groups as { group: string; groupLabel: string }[] | undefined) ?? []
  if (existing.some(g => g.group === group)) {
    return NextResponse.json({ error: `A group named "${group}" already exists` }, { status: 409 })
  }

  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key:       { PK: `ORG#${orgId}`, SK: 'PROFILE' },
    UpdateExpression: 'SET form_groups = list_append(if_not_exists(form_groups, :empty), :newGroup)',
    ExpressionAttributeValues: {
      ':empty':    [],
      ':newGroup': [{ group, groupLabel }],
    },
  }))

  return NextResponse.json({ ok: true, group, groupLabel, formGroups: [...existing, { group, groupLabel }] })
}
