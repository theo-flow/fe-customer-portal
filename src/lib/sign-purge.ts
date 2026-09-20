import type { SignSession, SessionStatus, Signer } from '@/lib/sign'

// Deleting a session's documents. Mirrors SignSession.purged_copy in
// shared/models/sign_session.py (fn-18 uses that one for the automatic cleanup
// of unfinished sessions); keep the two in step.

// Only ever delete under these prefixes, whatever a record claims its key is.
export const PURGEABLE_PREFIXES = ['sign/source/', 'sign/completed/'] as const

// A session that is still open must be cancelled first.
export const DELETABLE_STATUSES: readonly SessionStatus[] = ['SIGNED', 'CANCELLED', 'EXPIRED', 'DECLINED', 'FAILED']

export const isPurged = (session: Pick<SignSession, 'metadata'>): boolean =>
  !!(session.metadata && (session.metadata as Record<string, unknown>).documents_deleted_at)

// The files to delete, or null if any key is outside the sign folders (then
// nothing is deleted at all).
export function purgeableKeys(session: SignSession): string[] | null {
  const keys = [session.source_document?.s3_key, session.completed_document?.s3_key].filter((k): k is string => !!k)
  return keys.every(k => PURGEABLE_PREFIXES.some(p => k.startsWith(p))) ? keys : null
}

// What is left of a session once its documents are gone: that it existed, its
// status, timestamps, roles and fingerprints, but no names, emails, IP
// addresses, browsers, signatures, consent records, boxes or file names. The
// organisation pointer is untouched, so counts (billing, the list) stay right.
export function purgedCopy(session: SignSession, nowIso: string): SignSession {
  const meta = (session.metadata ?? {}) as Record<string, unknown>
  const kept: Record<string, unknown> = {}
  for (const k of ['form_name', 'submission_id']) if (meta[k] !== undefined) kept[k] = meta[k]

  const signers: Signer[] = session.signers.map(s => ({
    signer_id: s.signer_id, name: '', email: '', role: s.role, order: s.order, status: s.status,
    token_hash: '', token_expires_at: '', token_used: true, signed_at: s.signed_at,
    ip_address: null, user_agent: null, signature_type: null, signature_data: null, place_data: null, email_sent: false,
  }))

  const completed = session.completed_document
  return {
    session_id: session.session_id,
    source_document: { s3_key: '', sha256: session.source_document?.sha256, uploaded_at: session.source_document?.uploaded_at },
    working_document: {},
    signers,
    status: session.status,
    created_at: session.created_at,
    updated_at: nowIso,
    ...(completed ? { completed_document: { sealed_at: completed.sealed_at, sha256: completed.sha256 } } : {}),
    metadata: { ...kept, documents_deleted_at: nowIso },
  } as SignSession
}
