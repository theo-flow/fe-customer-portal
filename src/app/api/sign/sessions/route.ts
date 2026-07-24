import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID, createHash } from 'crypto'
import { ddbDocClient, s3Client, sqsClient, TABLE, BUCKET } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { validateEmail } from '@/lib/validators'
import { generateToken, hashToken, tokenExpiryIso, type SignSession, type Signer } from '@/lib/sign'

const SQS_SIGN_URL = process.env.SQS_SIGN_URL

interface SignerInput {
  name?:  string
  email?: string
  role?:  string
}

interface RequestBody {
  signers?:        SignerInput[]
  submissionId?:   string
  sourceDocument?: { sessionId?: string; s3Key?: string; sha256?: string; filename?: string }
}

export async function GET(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = ddbDocClient()

  const index = await db.send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'SESSION#' },
  }))

  const pointers = index.Items ?? []
  const sessions = await Promise.all(
    pointers.map(async (p) => {
      const result = await db.send(new GetCommand({
        TableName: TABLE,
        Key:       { PK: `SESSION#${p.sessionId}`, SK: 'SESSION' },
      }))
      const session = result.Item as SignSession | undefined
      if (!session) return null
      return {
        sessionId:     session.session_id,
        status:        session.status,
        createdAt:     session.created_at,
        updatedAt:     session.updated_at,
        submissionId:  (session.metadata as { submission_id?: string } | null)?.submission_id ?? null,
        completedKey:  session.completed_document?.s3_key ?? null,
        signers: session.signers.map(s => ({
          signerId: s.signer_id, name: s.name, email: s.email, status: s.status,
        })),
      }
    })
  )

  return NextResponse.json({ sessions: sessions.filter(Boolean) })
}

export async function POST(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: RequestBody
  try {
    body = await req.json()
  } catch (err) {
    console.error('[sign/sessions] Failed to parse request body', { orgId, error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { signers: signerInputs, submissionId, sourceDocument } = body

  if (!signerInputs || signerInputs.length === 0) {
    return NextResponse.json({ error: 'At least one signer is required' }, { status: 400 })
  }
  for (const s of signerInputs) {
    if (!s.name || !s.name.trim()) {
      return NextResponse.json({ error: 'Every signer needs a name' }, { status: 400 })
    }
    if (!s.email || validateEmail(s.email)) {
      return NextResponse.json({ error: `Invalid signer email: ${s.email ?? '(missing)'}` }, { status: 400 })
    }
  }

  if (!submissionId && !sourceDocument) {
    return NextResponse.json({ error: 'Provide either submissionId or sourceDocument' }, { status: 400 })
  }
  if (submissionId && sourceDocument) {
    return NextResponse.json({ error: 'Provide only one of submissionId or sourceDocument' }, { status: 400 })
  }

  const db = ddbDocClient()
  const s3  = s3Client()
  const now = new Date().toISOString()

  let sessionId: string
  let sourceKey: string
  let sourceSha256: string
  let metadata: Record<string, unknown> | null = null

  try {
    if (sourceDocument) {
      // Standalone entry point — file was already uploaded via /api/sign/upload/presign.
      if (!sourceDocument.sessionId || !sourceDocument.s3Key || !sourceDocument.sha256) {
        return NextResponse.json({ error: 'Incomplete sourceDocument' }, { status: 400 })
      }
      const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: sourceDocument.s3Key }))
        .catch(() => null)
      if (!head) {
        return NextResponse.json({ error: 'Uploaded document not found — upload may have failed' }, { status: 400 })
      }
      sessionId    = sourceDocument.sessionId
      sourceKey    = sourceDocument.s3Key
      sourceSha256 = sourceDocument.sha256
    } else {
      // VALIDATED-attach entry point — copy the existing document into the sign/ prefix.
      const doc = await db.send(new GetCommand({
        TableName: TABLE,
        Key:       { PK: `DOC#${submissionId}`, SK: 'STATUS' },
      }))
      if (!doc.Item || doc.Item.orgId !== orgId) {
        return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
      }

      sessionId = randomUUID()
      const filename = doc.Item.filename as string
      sourceKey = `sign/source/${sessionId}/${filename}`

      const original = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: doc.Item.s3Key as string }))
      const bytes = await original.Body!.transformToByteArray()
      sourceSha256 = createHash('sha256').update(bytes).digest('hex')

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: sourceKey, Body: bytes, ContentType: 'application/pdf',
      }))

      metadata = { submission_id: submissionId }
    }
  } catch (err) {
    console.error('[sign/sessions] Failed to resolve source document', { orgId, submissionId, error: err })
    return NextResponse.json({ error: 'Failed to prepare source document' }, { status: 500 })
  }

  const rawTokens = new Map<string, string>()  // signer_id -> raw token (never persisted)
  const signers: Signer[] = signerInputs.map((s, i) => {
    const signerId  = randomUUID()
    const rawToken  = generateToken()
    rawTokens.set(signerId, rawToken)
    return {
      signer_id:       signerId,
      name:             s.name!.trim(),
      email:            s.email!.trim(),
      role:             s.role?.trim() || null,
      order:            i + 1,
      status:           'PENDING',
      token_hash:       hashToken(rawToken),
      token_expires_at: tokenExpiryIso(),
      token_used:       false,
      signed_at:        null,
      ip_address:       null,
      user_agent:       null,
      signature_type:   null,
      signature_data:   null,
      place_data:       null,
      email_sent:       false,
    }
  })

  const session: SignSession = {
    session_id:       sessionId,
    source_document:  { s3_key: sourceKey, sha256: sourceSha256, uploaded_at: now },
    working_document: {},
    signers,
    status:           'PENDING',
    created_at:        now,
    updated_at:        now,
    ...(metadata ? { metadata } : {}),
  }

  try {
    // 1. Session item — the aggregate root fn-13 reads/writes.
    await db.send(new PutCommand({
      TableName: TABLE,
      Item:      { PK: `SESSION#${sessionId}`, SK: 'SESSION', ...session },
    }))

    // 2. Org-index pointer — SESSION# items are keyed by session_id, not org_id
    //    (document-centric per the strategic doc), so there's no way to list an
    //    org's sessions without this, mirroring the DOC#/ORG# pattern used by
    //    api/uploads/presign for the same reason.
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `ORG#${orgId}`, SK: `SESSION#${sessionId}`,
        sessionId, orgId, signerCount: signers.length,
        submissionId: submissionId ?? null,
        createdAt: now,
      },
    }))
  } catch (err) {
    console.error('[sign/sessions] DynamoDB write failed', { orgId, sessionId, error: err })
    return NextResponse.json({ error: 'Failed to create signing session' }, { status: 500 })
  }

  // req.nextUrl.origin is unreliable inside the OpenNext/Lambda runtime (it
  // resolves to the Next.js dev-server default, localhost:3000, since there's
  // no trusted proxy config threading the real Host through) -- prefer the
  // deployed app's known public URL, falling back to nextUrl for local dev.
  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  const signerLinks = signers.map(s => ({
    signerId: s.signer_id,
    name:      s.name,
    email:     s.email,
    signUrl:   `${origin}/sign/${sessionId}/${s.signer_id}/${rawTokens.get(s.signer_id)}`,
  }))

  // Kick off async detection + emailing in fn-13 (see document_locator.py /
  // handler.py's locate_and_notify flow). The raw signing tokens above are
  // never persisted anywhere (Signer.token_hash is one-way) -- this message
  // is the only place fn-13 can ever see a signer's actual sign_url, so it
  // has to travel in the message body itself, not be looked up later.
  let locateQueued = false
  if (SQS_SIGN_URL) {
    try {
      const requestedBy = await _lookupOrgName(db, orgId)
      await sqsClient().send(new SendMessageCommand({
        QueueUrl: SQS_SIGN_URL,
        MessageBody: JSON.stringify({
          session_id: sessionId,
          action: 'locate_and_notify',
          signer_links: signerLinks.map(l => ({ signer_id: l.signerId, sign_url: l.signUrl })),
          requested_by: requestedBy,
        }),
      }))
      locateQueued = true
    } catch (err) {
      // Never fail session creation over this -- the org user still has the
      // manual copy-link fallback below. But this does mean automatic
      // detection/emailing won't happen for this session, so it's surfaced
      // in the response rather than silently swallowed.
      console.error('[sign/sessions] Failed to enqueue locate_and_notify', { orgId, sessionId, error: err })
    }
  } else {
    console.error('[sign/sessions] SQS_SIGN_URL not configured -- locate_and_notify not queued', { sessionId })
  }

  return NextResponse.json({ sessionId, signers: signerLinks, locateQueued }, { status: 201 })
}

async function _lookupOrgName(db: ReturnType<typeof ddbDocClient>, orgId: string): Promise<string | null> {
  try {
    const result = await db.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `ORG#${orgId}`, SK: 'PROFILE' },
      ProjectionExpression: 'orgName',
    }))
    return (result.Item?.orgName as string | undefined) || null
  } catch (err) {
    console.error('[sign/sessions] Org name lookup failed', { orgId, error: err })
    return null
  }
}
