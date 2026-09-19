import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, s3Client, TABLE, BUCKET } from '@/lib/aws'
import { hasPdfHeader } from '@/lib/sign-server'
import { validateLayout } from '@/lib/sign-form'
import {
  requireOperator, orgExists, isSafeId, pointerKey, versionKey, sampleKey, isTransactionConflict,
  readBoxes, loadCurrentForm, sameSize,
} from '@/lib/sign-forms-server'

// List a customer's Sign forms (pointers only, newest change first).
export async function GET(_req: NextRequest, { params }: { params: { orgId: string } }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { orgId } = params
  if (!isSafeId(orgId)) return NextResponse.json({ error: 'Invalid organisation' }, { status: 400 })
  if (!(await orgExists(orgId))) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })

  try {
    const res = await ddbDocClient().send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'SIGNFORM#' },
    }))
    const forms = (res.Items ?? [])
      .filter(i => i.form_status !== 'ARCHIVED')
      .map(i => ({
        formId:         i.form_id as string,
        name:           i.name as string,
        currentVersion: i.current_version as number,
        pageCount:      i.page_count as number,
        roles:          (i.roles as string[]) ?? [],
        fieldCount:     (i.field_count as number) ?? 0,
        valid:          !!i.valid,
        updatedAt:      i.updated_at as string,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return NextResponse.json({ forms })
  } catch (err) {
    console.error('[operator/sign-forms] List failed', { orgId, error: err })
    return NextResponse.json({ error: 'Failed to load forms' }, { status: 500 })
  }
}

// Step 2 of creating a Sign form: the sample is already in S3. Records the
// form with version 1 (one default role, no boxes yet) so the operator can
// open the editor. Page count and size come from the browser, which has
// already opened the PDF to show it.
//
// With copyFrom, version 1 starts from another form's roles, boxes and
// recognition phrases instead. Only the LAYOUT is copied: never the other
// customer's sample document (it may be a filled-in copy) and never their
// fixed default signers (real people at that customer). The new sample must
// have the same pages as the form being copied, or the boxes would not line up.
export async function POST(req: NextRequest, { params }: { params: { orgId: string } }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { orgId } = params
  if (!isSafeId(orgId)) return NextResponse.json({ error: 'Invalid organisation' }, { status: 400 })
  if (!(await orgExists(orgId))) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })

  let body: {
    formId?: string; name?: string; pageCount?: number; pageWidth?: number; pageHeight?: number
    copyFrom?: { orgId?: string; formId?: string }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!isSafeId(body.formId)) return NextResponse.json({ error: 'Invalid form id' }, { status: 400 })
  const formId = body.formId

  let source: Awaited<ReturnType<typeof loadCurrentForm>> = null
  if (body.copyFrom !== undefined) {
    const from = body.copyFrom
    if (!from || !isSafeId(from.orgId) || !isSafeId(from.formId)) {
      return NextResponse.json({ error: 'Invalid form to copy' }, { status: 400 })
    }
    try {
      source = await loadCurrentForm(from.orgId, from.formId)
    } catch (err) {
      console.error('[operator/sign-forms] Load of the form to copy failed', { orgId, error: err })
      return NextResponse.json({ error: 'Failed to load the form to copy' }, { status: 500 })
    }
    if (!source) return NextResponse.json({ error: 'The form to copy was not found.' }, { status: 404 })
    const v = source.version
    if (body.pageCount !== v.page_count
        || typeof body.pageWidth !== 'number' || typeof body.pageHeight !== 'number'
        || !sameSize(body.pageWidth, v.page_width as number) || !sameSize(body.pageHeight, v.page_height as number)) {
      return NextResponse.json({
        error: `This sample does not have the same pages as the form being copied (${v.page_count} page${v.page_count === 1 ? '' : 's'}, same size). Upload a blank copy of that form.`,
      }, { status: 400 })
    }
  }

  const checked = validateLayout({
    name: body.name, page_count: body.pageCount, page_width: body.pageWidth, page_height: body.pageHeight,
    roles: source ? source.version.roles : ['Customer'],
    fields: source ? (source.version.fields ?? []) : [],
    anchors: source ? (source.version.anchors ?? []) : [],
    role_defaults: [],
  })
  if (!checked.ok) return NextResponse.json({ error: checked.errors[0], errors: checked.errors }, { status: 400 })

  // The sample must really be there, and really be a PDF.
  const key = sampleKey(orgId, formId)
  const s3 = s3Client()
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => null)
  if (!head) return NextResponse.json({ error: 'The sample upload was not found. Please upload it again.' }, { status: 400 })
  const first = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: 'bytes=0-4' }))
    .then(r => r.Body!.transformToByteArray()).catch(() => null)
  if (!first || !hasPdfHeader(first)) {
    return NextResponse.json({ error: 'The sample must be a PDF.' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { layout } = checked
  try {
    await ddbDocClient().send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: {
              ...pointerKey(orgId, formId),
              form_id: formId, org_id: orgId, form_status: 'ACTIVE',
              name: layout.name, current_version: 1,
              page_count: layout.page_count, page_width: layout.page_width, page_height: layout.page_height,
              roles: layout.roles, anchors: layout.anchors, read_boxes: readBoxes(layout.fields), role_defaults: [],
              field_count: layout.fields.length, valid: checked.valid,
              created_at: now, updated_at: now, updated_by: auth.claims.email,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              ...versionKey(orgId, formId, 1),
              form_id: formId, org_id: orgId, version: 1, ...layout,
              sample_key: key, valid: checked.valid, created_at: now, created_by: auth.claims.email,
              ...(source ? { copied_from: { org_id: body.copyFrom!.orgId, form_id: body.copyFrom!.formId, version: source.version.version } } : {}),
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    }))
  } catch (err) {
    if (isTransactionConflict(err)) return NextResponse.json({ error: 'That form already exists.' }, { status: 409 })
    console.error('[operator/sign-forms] Create failed', { orgId, formId, error: err })
    return NextResponse.json({ error: 'Failed to create the form' }, { status: 500 })
  }

  return NextResponse.json({ formId, version: 1, copied: !!source }, { status: 201 })
}
