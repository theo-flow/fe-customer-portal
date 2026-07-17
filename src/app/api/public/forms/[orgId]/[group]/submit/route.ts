import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { validateField } from '@/lib/validators'
import { notifyHarvestSubmission } from '@/lib/notifications'
import { randomUUID } from 'crypto'

interface Field {
  key:        string
  label:      string
  field_type: string
  required:   boolean
  options:    string[] | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: { orgId: string; group: string } },
) {
  const { orgId, group } = params

  // Fetch the schema
  const schemaResult = await ddbDocClient().send(new GetCommand({
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

  // Validate every field
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const err = validateField(
      field.field_type,
      values[field.key] ?? '',
      field.required,
      field.label,
    )
    if (err) errors[field.key] = err
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 })
  }

  // Write submission to DynamoDB
  const submissionId = randomUUID()
  const now = new Date().toISOString()

  const groupLabel = schemaResult.Item.group_label as string

  await ddbDocClient().send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK:          `ORG#${orgId}`,
      SK:          `SUBMISSION#${submissionId}`,
      submissionId,
      orgId,
      group,
      group_label: groupLabel,
      values,
      submittedAt: now,
      status:      'RECEIVED',
    },
  }))

  // Best-effort -- never throws, so it can't turn a successful submission
  // into a failed response. Awaited anyway so it actually runs before the
  // Lambda execution environment can be frozen post-response.
  await notifyHarvestSubmission(orgId, { submissionId, group, groupLabel })

  return NextResponse.json({ referenceId: submissionId }, { status: 201 })
}
