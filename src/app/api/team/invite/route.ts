import { AdminCreateUserCommand, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider'
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { cognitoClient, ddbDocClient, TABLE, USER_POOL_ID } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { forbiddenUnlessAdmin } from '@/lib/roles'
import { validateEmail } from '@/lib/validators'
import { loadTeam, memberKey, membershipKey, seatAllowance, seatsUsed } from '@/lib/team'
import { writeAudit } from '@/lib/audit'
import { enqueueTeamInviteEmail } from '@/lib/notify-queue'
import { generateTempPassword, TEMP_PASSWORD_VALID_DAYS } from '@/lib/temp-password'
import { DEFAULT_APP_URL } from '@/lib/email-templates'

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
  const temporaryPassword = generateTempPassword()
  let sub: string | undefined
  try {
    // Cognito's own email is suppressed: the invite is rendered from the portal's
    // template (src/lib/email-templates.ts) and sent through the notify queue.
    const created = await cognito.send(new AdminCreateUserCommand({
      UserPoolId:        USER_POOL_ID,
      Username:          email,
      MessageAction:     'SUPPRESS',
      TemporaryPassword: temporaryPassword,
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
    await removeInvitee(cognito, email)
    return NextResponse.json({ error: 'Could not send the invite. Please try again.' }, { status: 500 })
  }

  // Nobody can sign in without this email, so a failed send undoes the invite
  // rather than leaving a seat held by someone who was never told.
  const sent = await enqueueTeamInviteEmail({
    correlationId:     `team-invite-${orgId}-${sub}`,
    toEmail:           email,
    inviteeName:       name,
    orgName:           await lookupOrgName(orgId),
    invitedBy:         claims.name?.trim() || claims.email,
    temporaryPassword,
    signInUrl:         `${process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL}/login`,
    validDays:         TEMP_PASSWORD_VALID_DAYS,
  })
  if (!sent) {
    console.error('[team/invite] Invite email not queued, undoing invite', { orgId })
    const db = ddbDocClient()
    await Promise.all([
      db.send(new DeleteCommand({ TableName: TABLE, Key: membershipKey(sub) })),
      db.send(new DeleteCommand({ TableName: TABLE, Key: memberKey(orgId, sub) })),
    ]).catch(e => console.error('[team/invite] Cleanup of membership records failed', { orgId, error: e }))
    await removeInvitee(cognito, email)
    return NextResponse.json({ error: 'Could not send the invite email. Please try again.' }, { status: 502 })
  }

  await writeAudit(orgId, claims, 'team.invite', email)

  return NextResponse.json(
    { member: { sub, email, name, role: 'agent', status: 'invited', invitedBy: claims.sub, createdAt: now } },
    { status: 201 },
  )
}

type Cognito = ReturnType<typeof cognitoClient>

async function removeInvitee(cognito: Cognito, email: string): Promise<void> {
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: email }))
    .catch(e => console.error('[team/invite] Cleanup AdminDeleteUser failed', { error: e }))
}

async function lookupOrgName(orgId: string): Promise<string> {
  try {
    const r = await ddbDocClient().send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `ORG#${orgId}`, SK: 'PROFILE' },
      ProjectionExpression: 'orgName',
    }))
    return (r.Item?.orgName as string | undefined) || 'your organisation'
  } catch (err) {
    console.error('[team/invite] Org name lookup failed', { orgId, error: err })
    return 'your organisation'
  }
}
