import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import type { Field as SchemaField } from '@/components/FieldInput'
import type { ExtractionData } from '@/components/ExtractedDataView'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = ddbDocClient()

  // PK is derived from the caller's own org claim, never from the URL --
  // a submissionId belonging to another org simply won't be found here.
  const result = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `SUBMISSION#${params.id}` },
  }))

  const item = result.Item
  if (!item) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })

  const group  = item.group as string
  const values = (item.values as Record<string, string>) ?? {}

  let schemaFields: SchemaField[] = []
  try {
    const schemaResult = await db.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}` },
    }))
    schemaFields = (schemaResult.Item?.fields as SchemaField[]) ?? []
  } catch {
    // Group's schema may have been re-forged/removed since this submission
    // came in -- fall back to whatever keys the submission itself has.
    schemaFields = []
  }

  // A field is "missing" here only in the sense of "left blank" -- required
  // fields are already enforced at submit time, so this only ever flags
  // optional fields the client chose not to answer.
  const unresolvedFields = schemaFields
    .filter(f => !values[f.key])
    .map(f => f.key)

  const extraction: ExtractionData = {
    fields: values,
    schemaFields,
    aiResolvedFields: [],
    flaggedFields: [],
    unresolvedFields,
  }

  return NextResponse.json({
    submissionId: item.submissionId as string,
    group,
    groupLabel:   item.group_label as string,
    submittedAt:  item.submittedAt as string,
    status:       item.status as string,
    extraction,
  })
}
