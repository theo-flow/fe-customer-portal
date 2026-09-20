import { AdminCreateUserCommand, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { cognitoClient, ddbDocClient, TABLE, USER_POOL_ID } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { forbiddenUnlessAdmin } from '@/lib/roles'
import { validateEmail } from '@/lib/validators'
import { loadTeam, memberKey, membershipKey, seatAllowance, seatsUsed } from '@/lib/team'
import { writeAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = forbiddenUnlessAdmin(claims)
  if (denied) return denied

  let body: { email?: string; name?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const name  = body.name?.trim()
  const email = body.email?.trim().toLowerCase()
  if (!name) return NextResponse.json({ error: "Enter the agent's name." }, { status: 400 })
  if (!email || validateEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  const [members, seats] = await Promise.all([loadTeam(orgId, claims), seatAllowance(orgId)])
  const used = seatsUsed(members)

  // Invited people hold a seat until removed, so re-sending can't oversubscribe.
  if (used >= seats.totalSeats) {
    // A pilot has one seat and starts the paid plan to add people; a paid org adds a seat.
    const error = seats.canChangeSeats
      ? `All ${seats.totalSeats} seats are in use. Add a seat to invite someone else.`
      : 'Your pilot has one seat. Start the paid plan to add people to your team.'
    return NextResponse.json(
      { error, seatsUsed: used, totalSeats: seats.totalSeats, canChangeSeats: seats.canChangeSeats },
      { status: 409 },
    )
  }
  if (members.some(m => m.email.toLowerCase() === email)) {
    return NextResponse.json({ error: 'That person is already on your team.' }, { status: 409 })
  }

  const cognito = cognitoClient()
  let sub: string | undefined
  try {
    // Cognito emails the invite with a temporary password through
    // fn-15-cognito-custom-message's CustomMessage_AdminCreateUser template.
    const created = await cognito.send(new AdminCreateUserCommand({
      UserPoolId:             USER_POOL_ID,
      Username:               email,
      DesiredDeliveryMediums: ['EMAIL'],
      UserAttributes: [
        { Name: 'email',          Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name',           Value: name },
        { Name: 'custom:org_id',  Value: orgId },
      ],
    }))
    sub = created.User?.Attributes?.find(a => a.Name === 'sub')?.Value
    if (!sub) throw new Error('Cognito returned no sub for the new user')
  } catch (err) {
    if ((err as { name?: string })?.name === 'UsernameExistsException') {
      return NextResponse.json({ error: 'That email already has a TheoFlow account.' }, { status: 409 })
    }
    console.error('[team/invite] AdminCreateUser failed', { orgId, error: err })
    return NextResponse.json({ error: 'Could not send the invite. Please try again.' }, { status: 500 })
  }

  const now = new Date().toISOString()
  try {
    const db = ddbDocClient()
    // The authoritative record fn-21 reads on every login. PostConfirmation
    // never fires for admin-created users, so it is written here.
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: { ...membershipKey(sub), orgId, role: 'agent', status: 'invited', source: 'invite' },
      ConditionExpression: 'attribute_not_exists(PK)',
    }))
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: {
        ...memberKey(orgId, sub),
        sub, email, name, role: 'agent', status: 'invited', invitedBy: claims.sub, createdAt: now,
      },
    }))
  } catch (err) {
    // A Cognito user with no membership record gets no org, so an orphan is
    // harmless, but remove it so the same email can be invited again.
    console.error('[team/invite] Membership write failed, removing Cognito user', { orgId, error: err })
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: email }))
      .catch(e => console.error('[team/invite] Cleanup AdminDeleteUser failed', { orgId, error: e }))
    return NextResponse.json({ error: 'Could not send the invite. Please try again.' }, { status: 500 })
  }

  await writeAudit(orgId, claims, 'team.invite', email)

  return NextResponse.json(
    { member: { sub, email, name, role: 'agent', status: 'invited', invitedBy: claims.sub, createdAt: now } },
    { status: 201 },
  )
}
