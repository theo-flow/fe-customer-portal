import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { fromIni } from '@aws-sdk/credential-providers'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

const REGION = process.env.AWS_REGION ?? 'af-south-1'
const TABLE  = process.env.DYNAMODB_TABLE_CONTACT ?? 'daai-insure-contact-messages'

function dynamo() {
  const profile = process.env.AWS_PROFILE
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: REGION, credentials: profile ? fromIni({ profile }) : undefined })
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_LEN = { name: 200, email: 200, org: 200, message: 5000 }

export async function POST(req: NextRequest) {
  const { name, email, org, message } = await req.json() as {
    name?: string; email?: string; org?: string; message?: string
  }

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return NextResponse.json({ error: 'name, email and message are required' }, { status: 400 })
  }
  if (!EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: 'email is not a valid email address' }, { status: 400 })
  }
  if (name.length > MAX_LEN.name || email.length > MAX_LEN.email ||
      (org?.length ?? 0) > MAX_LEN.org || message.length > MAX_LEN.message) {
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
      org:       org?.trim() ?? '',
      message:   message.trim(),
      createdAt: now,
      status:    'new',
    },
  }))

  return NextResponse.json({ messageId })
}
