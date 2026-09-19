import { randomUUID } from 'crypto'
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, sqsClient, TABLE } from '@/lib/aws'
import { requireOperator, isSafeId, suggestionKey, loadCurrentForm } from '@/lib/sign-forms-server'

// "Suggest boxes" in the form editor. POST starts detection on the form's
// sample (fn-13 does the work through the sign queue, as it does for sessions);
// GET is what the editor polls for the answer. The result lives in its own item
// (SIGNSUGG#), never in the form itself: it is only a suggestion until the
// operator has looked at it and saved.

const SQS_SIGN_URL = process.env.SQS_SIGN_URL
// Detection takes well under a minute. A request still pending after this long
// is treated as lost so the operator can simply try again, and a request that
// is still running is not started a second time (each run costs Textract and
// Bedrock calls).
const STALE_AFTER_MS = 5 * 60 * 1000

type Params = { params: { orgId: string; formId: string } }

const ageMs = (iso: unknown) => (typeof iso === 'string' ? Date.now() - Date.parse(iso) : Infinity)

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { orgId, formId } = params
  if (!isSafeId(orgId) || !isSafeId(formId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  if (!SQS_SIGN_URL) {
    console.error('[operator/sign-forms/suggest] SQS_SIGN_URL is not set')
    return NextResponse.json({ error: 'Suggesting boxes is not available right now.' }, { status: 503 })
  }

  const db = ddbDocClient()
  try {
    if (!(await loadCurrentForm(orgId, formId))) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

    const existing = (await db.send(new GetCommand({ TableName: TABLE, Key: suggestionKey(orgId, formId) }))).Item
    if (existing?.suggestion_status === 'PENDING' && ageMs(existing.requested_at) < STALE_AFTER_MS) {
      return NextResponse.json({ requestId: existing.request_id, alreadyRunning: true }, { status: 202 })
    }

    const requestId = randomUUID()
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: {
        ...suggestionKey(orgId, formId), org_id: orgId, form_id: formId, request_id: requestId,
        suggestion_status: 'PENDING', requested_at: new Date().toISOString(), requested_by: auth.claims.email,
      },
    }))
    try {
      await sqsClient().send(new SendMessageCommand({
        QueueUrl: SQS_SIGN_URL,
        MessageBody: JSON.stringify({ action: 'detect_form', org_id: orgId, form_id: formId, request_id: requestId }),
      }))
    } catch (err) {
      // nothing is running, so do not leave a pending item that blocks a retry
      console.error('[operator/sign-forms/suggest] Queue failed', { orgId, formId, error: err })
      await db.send(new DeleteCommand({ TableName: TABLE, Key: suggestionKey(orgId, formId) })).catch(() => {})
      return NextResponse.json({ error: 'Could not start the suggestion. Please try again.' }, { status: 502 })
    }
    return NextResponse.json({ requestId }, { status: 202 })
  } catch (err) {
    console.error('[operator/sign-forms/suggest] Start failed', { orgId, formId, error: err })
    return NextResponse.json({ error: 'Could not start the suggestion.' }, { status: 500 })
  }
}

// { status: 'NONE' | 'PENDING' | 'DONE' | 'FAILED', requestId, fields }
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { orgId, formId } = params
  if (!isSafeId(orgId) || !isSafeId(formId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const item = (await ddbDocClient().send(new GetCommand({ TableName: TABLE, Key: suggestionKey(orgId, formId) }))).Item
    if (!item) return NextResponse.json({ status: 'NONE' })
    if (item.suggestion_status === 'DONE') {
      return NextResponse.json({ status: 'DONE', requestId: item.request_id, fields: item.fields ?? [] })
    }
    const lost = ageMs(item.requested_at) >= STALE_AFTER_MS
    return NextResponse.json({ status: lost ? 'FAILED' : 'PENDING', requestId: item.request_id })
  } catch (err) {
    console.error('[operator/sign-forms/suggest] Read failed', { orgId, formId, error: err })
    return NextResponse.json({ error: 'Could not read the suggestion.' }, { status: 500 })
  }
}
