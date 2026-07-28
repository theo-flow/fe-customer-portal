import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { fromIni } from '@aws-sdk/credential-providers'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { publishBusinessEvent } from '@/lib/hub-events'
import { INTEREST_VALUES, CONTACT_MESSAGE_MAX } from '@/lib/contact-form'

const REGION = process.env.AWS_REGION ?? 'af-south-1'
const TABLE  = process.env.DYNAMODB_TABLE_CONTACT ?? 'daai-insure-contact-messages'

// TheoFlow's own connector config lives under this fixed org_id in
// daai-insure-connectors -- this is the platform dogfooding its own
// Integration Hub on its own marketing leads (sub-phase 2 proof, per
// docs/integration-hub-status-and-next-steps.md), not a customer org.
const THEOFLOW_INTERNAL_ORG_ID = process.env.THEOFLOW_INTERNAL_ORG_ID ?? 'org-theoflow-internal'

function dynamo() {
  const profile = process.env.AWS_PROFILE
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: REGION, credentials: profile ? fromIni({ profile }) : undefined })
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_LEN = { name: 200, email: 200, org: 200, website: 255, message: CONTACT_MESSAGE_MAX }

export async function POST(req: NextRequest) {
  const { name, email, org, website, interest, message } = await req.json() as {
    name?: string; email?: string; org?: string; website?: string; interest?: string; message?: string
  }

  if (!name?.trim() || !email?.trim() || !org?.trim() || !interest?.trim()) {
    return NextResponse.json(
      { error: 'name, email, organisation and interest are required' }, { status: 400 }
    )
  }
  if (!EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: 'email is not a valid email address' }, { status: 400 })
  }
  if (!INTEREST_VALUES.includes(interest.trim())) {
    return NextResponse.json({ error: 'interest is not a recognised option' }, { status: 400 })
  }
  if (name.length > MAX_LEN.name || email.length > MAX_LEN.email || org.length > MAX_LEN.org ||
      (website?.length ?? 0) > MAX_LEN.website || (message?.length ?? 0) > MAX_LEN.message) {
    return NextResponse.json({ error: 'One or more fields exceed the maximum length' }, { status: 400 })
  }

  const messageId = `msg-${randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()

  await dynamo().send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK:        `MESSAGE#${messageId}`,
      SK:        'PROFILE',
      messageId,
      name:      name.trim(),
      email:     email.trim().toLowerCase(),
      org:       org.trim(),
      website:   website?.trim() ?? '',
      interest:  interest.trim(),
      message:   message?.trim() ?? '',
      createdAt: now,
      status:    'new',
    },
  }))

  // Sub-phase 2 dogfood: publish onto the Hub so fn-19/fn-20 can deliver this
  // lead to TheoFlow's own HubSpot sandbox, if a connector is configured for
  // THEOFLOW_INTERNAL_ORG_ID. Best-effort -- a failed publish must not fail
  // the visitor's contact-form submission.
  await publishBusinessEvent('ExportRequested', THEOFLOW_INTERNAL_ORG_ID, {
    object_type: 'Contact',
    object: {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      org: org.trim(),
      website: website?.trim() ?? '',
      interest: interest.trim(),
      message: message?.trim() ?? '',
      source: 'marketing_contact_form',
      message_id: messageId,
    },
  })

  return NextResponse.json({ messageId })
}
