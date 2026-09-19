import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, s3Client, TABLE, BUCKET } from '@/lib/aws'
import { validateLayout } from '@/lib/sign-form'
import {
  requireOperator, orgExists, isSafeId, pointerKey, versionKey, isTransactionConflict,
} from '@/lib/sign-forms-server'

const SAMPLE_URL_SECONDS = 900   // long enough for an editing session to load every page

type Params = { params: { orgId: string; formId: string } }

async function loadCurrent(orgId: string, formId: string) {
  const db = ddbDocClient()
  const pointer = await db.send(new GetCommand({ TableName: TABLE, Key: pointerKey(orgId, formId) }))
  if (!pointer.Item || pointer.Item.form_status === 'ARCHIVED') return null
  const version = await db.send(new GetCommand({
    TableName: TABLE, Key: versionKey(orgId, formId, pointer.Item.current_version as number),
  }))
  if (!version.Item) return null
  return { pointer: pointer.Item, version: version.Item }
}

// The current version of one form plus a short-lived link to its sample PDF,
// for the editor.
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { orgId, formId } = params
  if (!isSafeId(orgId) || !isSafeId(formId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let current
  try {
    current = await loadCurrent(orgId, formId)
  } catch (err) {
    console.error('[operator/sign-forms/:id] Load failed', { orgId, formId, error: err })
    return NextResponse.json({ error: 'Failed to load the form' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  const { version } = current

  let sampleUrl: string
  try {
    sampleUrl = await getSignedUrl(
      s3Client(),
      new GetObjectCommand({ Bucket: BUCKET, Key: version.sample_key as string }),
      { expiresIn: SAMPLE_URL_SECONDS },
    )
  } catch (err) {
    console.error('[operator/sign-forms/:id] Failed to presign sample', { orgId, formId, error: err })
    return NextResponse.json({ error: 'Failed to load the sample document' }, { status: 500 })
  }

  return NextResponse.json({
    formId,
    version:    version.version,
    valid:      !!version.valid,
    sampleUrl,
    layout: {
      name:        version.name,
      page_count:  version.page_count,
      page_width:  version.page_width,
      page_height: version.page_height,
      roles:       version.roles,
      fields:      version.fields ?? [],
      anchors:     version.anchors ?? [],
    },
  })
}

// Saves the editor's state as a NEW immutable version. The client says which
// version it started from; if someone saved in the meantime the save is
// refused (409) instead of silently overwriting their work. Page count and
// size are fixed by the sample and cannot be changed here.
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { orgId, formId } = params
  if (!isSafeId(orgId) || !isSafeId(formId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  if (!(await orgExists(orgId))) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })

  let body: { baseVersion?: number; layout?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!Number.isInteger(body.baseVersion)) return NextResponse.json({ error: 'baseVersion is required' }, { status: 400 })

  const checked = validateLayout(body.layout)
  if (!checked.ok) return NextResponse.json({ error: checked.errors[0], errors: checked.errors }, { status: 400 })
  const { layout } = checked

  let current
  try {
    current = await loadCurrent(orgId, formId)
  } catch (err) {
    console.error('[operator/sign-forms/:id] Load before save failed', { orgId, formId, error: err })
    return NextResponse.json({ error: 'Failed to load the form' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const { pointer, version: latest } = current
  if (pointer.current_version !== body.baseVersion) {
    return NextResponse.json(
      { error: 'Someone else saved this form after you opened it. Reload to see their changes.' },
      { status: 409 },
    )
  }
  if (layout.page_count !== pointer.page_count
      || Math.abs(layout.page_width - (pointer.page_width as number)) > 0.5
      || Math.abs(layout.page_height - (pointer.page_height as number)) > 0.5) {
    return NextResponse.json({ error: 'The page count and size come from the sample and cannot be changed.' }, { status: 400 })
  }

  const next = (body.baseVersion as number) + 1
  const now = new Date().toISOString()
  try {
    await ddbDocClient().send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: {
              ...versionKey(orgId, formId, next),
              form_id: formId, org_id: orgId, version: next, ...layout,
              sample_key: latest.sample_key, valid: checked.valid, created_at: now, created_by: auth.claims.email,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Update: {
            TableName: TABLE,
            Key: pointerKey(orgId, formId),
            UpdateExpression:
              'SET current_version = :next, #n = :name, roles = :roles, anchors = :anchors, field_count = :fc, valid = :valid, updated_at = :now, updated_by = :by',
            ConditionExpression: 'current_version = :base',
            ExpressionAttributeNames: { '#n': 'name' },
            ExpressionAttributeValues: {
              ':next': next, ':base': body.baseVersion, ':name': layout.name, ':roles': layout.roles, ':anchors': layout.anchors,
              ':fc': layout.fields.length, ':valid': checked.valid, ':now': now, ':by': auth.claims.email,
            },
          },
        },
      ],
    }))
  } catch (err) {
    if (isTransactionConflict(err)) {
      return NextResponse.json(
        { error: 'Someone else saved this form after you opened it. Reload to see their changes.' },
        { status: 409 },
      )
    }
    console.error('[operator/sign-forms/:id] Save failed', { orgId, formId, error: err })
    return NextResponse.json({ error: 'Failed to save the form' }, { status: 500 })
  }

  return NextResponse.json({ version: next, valid: checked.valid, warnings: checked.warnings })
}
