import { AdminDisableUserCommand } from '@aws-sdk/client-cognito-identity-provider'
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { cognitoClient, ddbDocClient, TABLE, USER_POOL_ID } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { forbiddenUnlessAdmin } from '@/lib/roles'
import { memberKey, membershipKey } from '@/lib/team'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { sub: string } },
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = forbiddenUnlessAdmin(claims)
  if (denied) return denied

  const { sub } = params
  if (sub === claims.sub) {
    return NextResponse.json({ error: "You can't remove yourself." }, { status: 400 })
  }

  const db = ddbDocClient()
  // Looked up under the caller's own org partition, so an admin can never
  // reach another org's member by guessing a sub.
  const found = await db.send(new GetCommand({ TableName: TABLE, Key: memberKey(orgId, sub) }))
  const member = found.Item
  if (!member || member.status === 'removed') {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  if (member.role === 'admin') {
    return NextResponse.json({ error: "An admin can't be removed." }, { status: 400 })
  }

  const removed = {
    UpdateExpression:          'SET #s = :removed',
    ExpressionAttributeNames:  { '#s': 'status' },
    ExpressionAttributeValues: { ':removed': 'removed' },
  }
  // fn-21 reads the USER# record on every token issuance, so this is the write
  // that actually locks them out; the listing item just frees the seat.
  await db.send(new UpdateCommand({ TableName: TABLE, Key: membershipKey(sub), ...removed }))
  await db.send(new UpdateCommand({ TableName: TABLE, Key: memberKey(orgId, sub), ...removed }))

  // Also stops Cognito refreshing their session. Their current ID token stays
  // valid until it expires (up to an hour).
  await cognitoClient().send(new AdminDisableUserCommand({
    UserPoolId: USER_POOL_ID, Username: member.email as string,
  })).catch(err => console.error('[team/remove] AdminDisableUser failed', { orgId, sub, error: err }))

  return NextResponse.json({ ok: true })
}
