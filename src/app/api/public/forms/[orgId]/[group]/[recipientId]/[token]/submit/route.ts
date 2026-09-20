import { randomUUID } from 'crypto'
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { validateField } from '@/lib/validators'
import { notifyHarvestSubmission } from '@/lib/notifications'
import { enqueueSubmissionReplyEmail } from '@/lib/notify-queue'
import { hashToken } from '@/lib/sign'
import type { RecipientLink } from '@/lib/recipients'
import { orgLocked } from '@/lib/org-access'

interface Field {
  key:        string
  label:      string
  field_type: string
  required:   boolean
  options:    string[] | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: { orgId: string; group: string; recipientId: string; token: string } },
) {
  const { orgId, group, recipientId, token } = params

  // A locked org's form links stop accepting submissions. Deliberately says nothing
  // about why: the person filling in the form is not the org's admin.
  if (await orgLocked(orgId)) {
    return NextResponse.json({ error: 'Form not available' }, { status: 404 })
  }
  const db = ddbDocClient()

  // Re-verify the token against a fresh read -- never trust the page-load
  // check, same as Sign's submit route.
  const recipientResult = await db.send(new GetCommand({
    TableName: TABLE,
    Key:       { PK: `ORG#${orgId}`, SK: `RECIPIENT#${group}#${recipientId}` },
  }))
  const recipient = recipientResult.Item as RecipientLink | undefined

  if (!recipient || recipient.token_hash !== hashToken(token)) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 })
  }
  if (new Date(recipient.token_expires_at) < new Date()) {
    return NextResponse.json({ error: 'Link expired' }, { status: 410 })
  }
  if (recipient.status === 'SUBMITTED') {
    return NextResponse.json({ error: 'This form has already been submitted' }, { status: 409 })
  }

  const schemaResult = await db.send(new GetCommand({
    TableName: TABLE,
    Key:       { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}` },
  }))
  if (!schemaResult.Item || schemaResult.Item.status !== 'READY') {
    return NextResponse.json({ error: 'Form not available' }, { status: 404 })
  }

  const fields = (schemaResult.Item.fields as Field[]) ?? []

  let body: { values?: Record<string, string> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const values = body.values ?? {}

  const errors: Record<string, string> = {}
  for (const field of fields) {
    const err = validateField(field.field_type, values[field.key] ?? '', field.required, field.label)
    if (err) errors[field.key] = err
  }
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 })
  }

  const submissionId = randomUUID()
  const now           = new Date().toISOString()
  const groupLabel    = schemaResult.Item.group_label as string

  await db.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK:              `ORG#${orgId}`,
      SK:              `SUBMISSION#${submissionId}`,
      submissionId,
      orgId,
      group,
      group_label:     groupLabel,
      values,
      submittedAt:     now,
      status:          'RECEIVED',
      recipient_id:    recipientId,
      recipient_name:  recipient.name,
      recipient_email: recipient.email,
    },
  }))

  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key:       { PK: `ORG#${orgId}`, SK: `RECIPIENT#${group}#${recipientId}` },
    UpdateExpression: 'SET #st = :submitted, submission_id = :submissionId, updated_at = :now',
    ExpressionAttributeNames:  { '#st': 'status' },
    ExpressionAttributeValues: { ':submitted': 'SUBMITTED', ':submissionId': submissionId, ':now': now },
  }))

  // Personal-link submissions notify only the agent who sent the link. Links
  // created before sent_by_* was recorded have no owner, and neither does a
  // link whose sender has since been removed (they can't sign in to see it),
  // so those fall back to the org-wide notification.
  const sender = await _activeSender(db, recipient)

  await notifyHarvestSubmission(orgId, {
    submissionId, group, groupLabel,
    targetSub:     sender?.sub ?? null,
    recipientName: recipient.name,
  })

  if (sender?.email) {
    await enqueueSubmissionReplyEmail({
      correlationId: submissionId,
      toEmail:       sender.email,
      recipientName: recipient.name,
      groupLabel,
      submissionUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://theoflow.bytheodore.co.za'}/submissions/${submissionId}`,
    })
  }

  return NextResponse.json({ referenceId: submissionId }, { status: 201 })
}

// The sending agent, if they still belong to the org. A failed lookup counts
// as "not active": an org-wide notification is a safe default, a lost one isn't.
async function _activeSender(
  db: ReturnType<typeof ddbDocClient>, recipient: RecipientLink,
): Promise<{ sub: string; email: string | null } | null> {
  if (!recipient.sent_by_sub) return null
  try {
    const membership = await db.send(new GetCommand({
      TableName: TABLE,
      Key:       { PK: `USER#${recipient.sent_by_sub}`, SK: 'ORG_MEMBERSHIP' },
    }))
    if (!membership.Item || membership.Item.status === 'removed') return null
    return { sub: recipient.sent_by_sub, email: recipient.sent_by_email ?? null }
  } catch (err) {
    console.error('[recipient-submit] Sender membership lookup failed', { error: err })
    return null
  }
}
