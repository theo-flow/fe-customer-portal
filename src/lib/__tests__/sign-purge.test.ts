import { describe, it, expect } from 'vitest'
import { makeSession, makeSigner } from './sign-fixtures'
import { DELETABLE_STATUSES, isPurged, purgeableKeys, purgedCopy } from '../sign-purge'

describe('sign-purge', () => {
  const signed = () => ({
    ...makeSession('SIGNED', [makeSigner({ name: 'Thandi', email: 't@example.com', role: 'Customer', status: 'SIGNED', signed_at: '2026-01-02T00:00:00.000Z', ip_address: '1.2.3.4' })]),
    completed_document: { s3_key: 'sign/completed/sess-1/completed.pdf', sealed_at: 's', sha256: 'h' },
    metadata: { form_name: 'F', created_by_email: 'a@b.c', submission_id: 'DOC-1' },
  })

  it('only finished sessions can have their documents deleted', () => {
    expect([...DELETABLE_STATUSES].sort()).toEqual(['CANCELLED', 'DECLINED', 'EXPIRED', 'FAILED', 'SIGNED'])
  })

  it('lists the files to delete, and refuses anything outside the sign folders', () => {
    expect(purgeableKeys(signed())).toEqual(['sign/source/sess-1/agreement.pdf', 'sign/completed/sess-1/completed.pdf'])
    const odd = signed()
    odd.source_document.s3_key = 'raw/other.pdf'
    expect(purgeableKeys(odd)).toBeNull()
    const open = makeSession('CANCELLED')
    expect(purgeableKeys(open)).toEqual(['sign/source/sess-1/agreement.pdf'])
  })

  it('leaves the record of the session but none of the people or files', () => {
    const t = purgedCopy(signed(), 'NOW')
    expect(isPurged(signed())).toBe(false)
    expect(isPurged(t)).toBe(true)
    expect(t).toMatchObject({ status: 'SIGNED', updated_at: 'NOW', created_at: '2026-01-01T00:00:00.000Z' })
    expect(t.source_document).toEqual({ s3_key: '', sha256: 'abc', uploaded_at: '2026-01-01T00:00:00.000Z' })
    expect(t.completed_document).toEqual({ sealed_at: 's', sha256: 'h' })
    expect(t.metadata).toEqual({ form_name: 'F', submission_id: 'DOC-1', documents_deleted_at: 'NOW' })
    expect(t.signers[0]).toMatchObject({ role: 'Customer', status: 'SIGNED', name: '', email: '', ip_address: null, token_used: true })
    expect(JSON.stringify(t)).not.toMatch(/Thandi|t@example|1\.2\.3\.4|a@b\.c/)
  })
})
