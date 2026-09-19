import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { ddbDocClient, s3Client, sqsClient, TABLE, BUCKET } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { validateEmail } from '@/lib/validators'
import {
  generateToken, hashToken, tokenExpiryIso, type DetectedField, type SignSession, type Signer,
} from '@/lib/sign'
import { hasPdfHeader, lookupOrgName } from '@/lib/sign-server'
import { isSafeId, pointerKey, versionKey } from '@/lib/sign-forms-server'
import type { FormField } from '@/lib/sign-form'

const SQS_SIGN_URL = process.env.SQS_SIGN_URL
const MAX_NAME_CHARS = 100

interface Body {
  formVersion?:    number
  sourceDocument?: { sessionId?: string; s3Key?: string; sha256?: string; filename?: string }
  signers?:        { role?: string; name?: string; email?: string }[]
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

// Sends one saved Sign form to one set of people. The customer's staff have
// uploaded THIS person's PDF (different name, amounts) and named who signs
// each role; the boxes, instructions and date formats come from the form the
// operator configured, pinned to the version that is current right now.
// Nothing here trusts the browser for anything that matters: the org comes
// from the token, the boxes come from the saved version, and the uploaded
// object must be under the key the server itself handed out.
export async function POST(req: NextRequest, { params }: { params: { formId: string } }) {
  const token = cookies().get('tf_token')?.value
  if (!token) return bad('Unauthorized', 401)
  const claims = await verifyJwtClaims(token)
  if (!claims) return bad('Unauthorized', 401)
  const orgId = claims['custom:org_id']
  if (!orgId) return bad('Forbidden', 403)

  const { formId } = params
  if (!isSafeId(formId)) return bad('Invalid form')

  let body: Body
  try {
    body = await req.json()
  } catch {
    return bad('Invalid request body')
  }

  const db = ddbDocClient()

  // ---- the form, as saved ----
  const pointer = await db.send(new GetCommand({ TableName: TABLE, Key: pointerKey(orgId, formId) })).catch(() => null)
  if (!pointer?.Item || pointer.Item.form_status === 'ARCHIVED') return bad('Form not found', 404)
  const version = await db.send(new GetCommand({
    TableName: TABLE, Key: versionKey(orgId, formId, pointer.Item.current_version as number),
  })).catch(() => null)
  if (!version?.Item) return bad('Form not found', 404)
  const form = version.Item
  if (!form.valid) return bad('This form is not ready to send yet.', 409)
  if (body.formVersion !== undefined && body.formVersion !== form.version) {
    return bad('This form was updated while you were preparing it. Reload the page and try again.', 409)
  }

  // ---- who signs each role ----
  const roles = form.roles as string[]
  const inputs = body.signers ?? []
  if (inputs.length !== roles.length || !roles.every(r => inputs.some(s => s.role === r))) {
    return bad(`Add a name and email for each of: ${roles.join(', ')}.`)
  }
  const seenEmails = new Set<string>()
  for (const s of inputs) {
    const name = (s.name ?? '').replace(/\s+/g, ' ').trim()
    if (!name || name.length > MAX_NAME_CHARS) return bad(`Enter a name for ${s.role}.`)
    if (!s.email || validateEmail(s.email)) return bad(`Enter a valid email for ${s.role}.`)
    const key = s.email.trim().toLowerCase()
    if (seenEmails.has(key)) return bad('Each person needs their own email. The same email is used for two roles.')
    seenEmails.add(key)
  }

  // ---- the uploaded document ----
  const src = body.sourceDocument
  if (!src?.sessionId || !src.s3Key || !src.sha256 || !isSafeId(src.sessionId)) return bad('Incomplete document')
  if (src.s3Key.split('/').slice(0, 3).join('/') !== `sign/source/${src.sessionId}`) return bad('Invalid document')
  const s3 = s3Client()
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: src.s3Key })).catch(() => null)
  if (!head) return bad('Uploaded document not found. The upload may have failed.')
  const first = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: src.s3Key, Range: 'bytes=0-4' }))
    .then(r => r.Body!.transformToByteArray()).catch(() => null)
  if (!first || !hasPdfHeader(first)) return bad('Only PDF documents can be sent for signature.')

  // ---- build the session from the layout ----
  const sessionId = src.sessionId
  const now = new Date().toISOString()

  const rawTokens = new Map<string, string>()
  const signers: Signer[] = roles.map((role, i) => {
    const input = inputs.find(s => s.role === role)!
    const signerId = randomUUID()
    const rawToken = generateToken()
    rawTokens.set(signerId, rawToken)
    return {
      signer_id: signerId, name: input.name!.replace(/\s+/g, ' ').trim(), email: input.email!.trim(), role,
      order: i + 1, status: 'PENDING', token_hash: hashToken(rawToken), token_expires_at: tokenExpiryIso(),
      token_used: false, signed_at: null, ip_address: null, user_agent: null,
      signature_type: null, signature_data: null, place_data: null, email_sent: false,
    }
  })

  const orderOf = (role: string) => roles.indexOf(role) + 1
  const detected: DetectedField[] = (form.fields as FormField[]).map(f => ({
    field_id: f.field_id, field_type: f.field_type,
    signer_order: orderOf(f.role), signer_role: f.role,
    page: f.page, x: f.x, y: f.y, width: f.width, height: f.height,
    instruction: f.instruction, required: f.required, confirmed_by_org: true,
    source: 'org_configured', confidence: 1,
    ...(f.date_format ? { date_format: f.date_format } : {}),
  }))

  const session: SignSession = {
    session_id: sessionId,
    source_document: { s3_key: src.s3Key, sha256: src.sha256, uploaded_at: now },
    working_document: {
      detected_fields: detected, detection_status: 'DONE', detected_at: now,
      form: { form_id: formId, version: form.version as number, name: form.name as string },
    },
    signers, status: 'PENDING', created_at: now, updated_at: now,
    // form_page_count lets fn-13 refuse to send or seal a document that no
    // longer matches the layout it was configured for.
    metadata: {
      created_by_email: claims.email, form_id: formId, form_version: form.version,
      form_name: form.name, form_page_count: form.page_count,
    },
  }

  try {
    await db.send(new PutCommand({
      TableName: TABLE, Item: { PK: `SESSION#${sessionId}`, SK: 'SESSION', ...session },
      // a session id is single use: never overwrite an existing one
      ConditionExpression: 'attribute_not_exists(PK)',
    }))
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: { PK: `ORG#${orgId}`, SK: `SESSION#${sessionId}`, sessionId, orgId, signerCount: signers.length, submissionId: null, createdAt: now },
    }))
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return bad('This upload has already been sent.', 409)
    console.error('[sign/forms/send] DynamoDB write failed', { orgId, formId, sessionId, error: err })
    return bad('Failed to create the signing session', 500)
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  const signerLinks = signers.map(s => ({
    signerId: s.signer_id, role: s.role, name: s.name, email: s.email,
    signUrl: `${origin}/sign/${sessionId}/${s.signer_id}/${rawTokens.get(s.signer_id)}`,
  }))

  let emailQueued = false
  if (SQS_SIGN_URL) {
    try {
      await sqsClient().send(new SendMessageCommand({
        QueueUrl: SQS_SIGN_URL,
        MessageBody: JSON.stringify({
          session_id: sessionId,
          action: 'notify_signers',
          signer_links: signerLinks.map(l => ({ signer_id: l.signerId, sign_url: l.signUrl })),
          requested_by: await lookupOrgName(orgId),
        }),
      }))
      emailQueued = true
    } catch (err) {
      // The session exists and the links are returned below, so the org can
      // still pass them on by hand.
      console.error('[sign/forms/send] Failed to enqueue signer emails', { sessionId, error: err })
    }
  } else {
    console.error('[sign/forms/send] SQS_SIGN_URL not configured, emails not queued', { sessionId })
  }

  return NextResponse.json({ sessionId, signers: signerLinks, emailQueued }, { status: 201 })
}
