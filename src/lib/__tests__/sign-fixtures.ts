import type { SessionStatus, SignSession, Signer, SignerStatus } from '@/lib/sign'

export const ORG_ID = 'org-abc123'
export const SESSION_ID = 'sess-1'

export function makeSigner(overrides: Partial<Signer> = {}): Signer {
  return {
    signer_id:        'signer-1',
    name:             'Jane Smith',
    email:            'jane@example.com',
    role:             null,
    order:            1,
    status:           'PENDING' as SignerStatus,
    token_hash:       'old-hash',
    token_expires_at: '2026-01-01T00:00:00.000Z',
    token_used:       false,
    signed_at:        null,
    ip_address:       null,
    user_agent:       null,
    signature_type:   null,
    signature_data:   null,
    place_data:       null,
    email_sent:       true,
    expired_at:       null,
    ...overrides,
  }
}

export function makeSession(status: SessionStatus, signers: Signer[] = [makeSigner()]): SignSession {
  return {
    session_id:       SESSION_ID,
    source_document:  { s3_key: `sign/source/${SESSION_ID}/agreement.pdf`, sha256: 'abc', uploaded_at: '2026-01-01T00:00:00.000Z' },
    working_document: {},
    signers,
    status,
    created_at:       '2026-01-01T00:00:00.000Z',
    updated_at:       '2026-01-02T00:00:00.000Z',
    metadata:         { created_by_email: 'owner@example.com' },
  }
}

interface DdbCommand { __type: string; input: { Key?: { PK: string; SK: string } } }

// Routes a mocked DynamoDB client by command type and key, mirroring the
// ORG#/SESSION# pointer lookup, the SESSION# item read, and the org PROFILE read.
export function ddbRouter(opts: { session: SignSession | null; pointer?: boolean; writeError?: unknown }) {
  return async (cmd: DdbCommand) => {
    if (cmd.__type === 'Get') {
      const key = cmd.input.Key!
      if (key.PK.startsWith('ORG#') && key.SK.startsWith('SESSION#')) return opts.pointer === false ? {} : { Item: {} }
      if (key.PK.startsWith('SESSION#')) return opts.session ? { Item: opts.session } : {}
      if (key.SK === 'PROFILE') return { Item: { orgName: 'Acme Brokers' } }
    }
    if (cmd.__type === 'Update' || cmd.__type === 'Put') {
      if (opts.writeError) throw opts.writeError
      return {}
    }
    return {}
  }
}
