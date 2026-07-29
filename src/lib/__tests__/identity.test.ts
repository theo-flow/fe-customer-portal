import { describe, it, expect } from 'vitest'
import { resolveIdentity } from '../identity'
import type { Field as SchemaField } from '@/components/FieldInput'

function emailField(key = 'applicant_email'): SchemaField {
  return { key, label: 'Email', field_type: 'email', required: true, options: null }
}

function textField(key: string): SchemaField {
  return { key, label: key, field_type: 'text', required: false, options: null }
}

describe('resolveIdentity', () => {
  // ── Tier 1: recipient link ──────────────────────────────────────────────

  it('recipient link wins when present, even over a matching schema field', () => {
    const result = resolveIdentity(
      { applicant_email: 'wrong@example.com' },
      [emailField()],
      'Jane Dlamini',
      'jane@example.com',
    )
    expect(result).toEqual({ email: 'jane@example.com', name: 'Jane Dlamini', source: 'recipient_link' })
  })

  it('recipient link with email only, no name', () => {
    const result = resolveIdentity({}, undefined, undefined, 'jane@example.com')
    expect(result).toEqual({ email: 'jane@example.com', name: null, source: 'recipient_link' })
  })

  it('blank recipient name is treated as null', () => {
    const result = resolveIdentity({}, undefined, '   ', 'jane@example.com')
    expect(result?.name).toBeNull()
  })

  it('missing recipient email falls through to the next tier', () => {
    const result = resolveIdentity(
      { applicant_email: 'jane@example.com' },
      [emailField()],
      'Jane Dlamini',
      null,
    )
    expect(result?.source).toBe('schema_field')
  })

  it('whitespace-only recipient email returns null overall (no other signal)', () => {
    const result = resolveIdentity({}, undefined, undefined, '   ')
    expect(result).toBeNull()
  })

  // ── Tier 2: schema field typed "email" ──────────────────────────────────

  it('resolves via the schema field typed email, and picks up the name field too', () => {
    // schemaFields includes a text field labeled "name" -- name resolution
    // now runs independently of the email tier, so this fills in too.
    const result = resolveIdentity(
      { applicant_email: 'sipho@example.co.za', name: 'Sipho' },
      [textField('name'), emailField('applicant_email')],
    )
    expect(result).toEqual({ email: 'sipho@example.co.za', name: 'Sipho', source: 'schema_field' })
  })

  it('falls through to regex when the email-typed field value is not email-shaped', () => {
    const result = resolveIdentity(
      { applicant_email: 'S1ph0###', notes: 'contact me at real@example.com please' },
      [emailField('applicant_email')],
    )
    expect(result).toEqual({ email: 'real@example.com', name: null, source: 'regex_fallback' })
  })

  it('skips straight to regex when no schema fields are given', () => {
    const result = resolveIdentity({ notes: 'reach me at fallback@example.com' })
    expect(result?.source).toBe('regex_fallback')
  })

  it('falls through when schema fields exist but none are typed email', () => {
    const result = resolveIdentity(
      { notes: 'reach me at fallback@example.com' },
      [textField('notes')],
    )
    expect(result?.source).toBe('regex_fallback')
  })

  // ── Tier 3: regex fallback ───────────────────────────────────────────────

  it('finds an email anywhere in free text', () => {
    const result = resolveIdentity({ comments: 'Please email john.doe@company.org about this' })
    expect(result).toEqual({ email: 'john.doe@company.org', name: null, source: 'regex_fallback' })
  })

  it('skips non-string field values', () => {
    const result = resolveIdentity({ age: 42, active: true, notes: null, email_text: 'x@y.com' })
    expect(result?.email).toBe('x@y.com')
  })

  // ── Name enrichment: independent of which email tier fired ───────────────
  // ── (the direct-share/non-tokenized-link bug found via live E2E testing) ─

  function nameField(key = 'full_name', label = 'Full name'): SchemaField {
    return { key, label, field_type: 'text', required: false, options: null }
  }

  it('direct-share regex fallback still picks up a schema name field', () => {
    // This is the exact bug: an org-direct-share Harvest submission has no
    // RecipientLink, no schema field typed "email" -- only a regex-matched
    // email and a plain text "Full name" field. Name must not be discarded.
    const result = resolveIdentity(
      { full_name: 'Thabo Nkosi', comments: 'reach me at thabo@example.com' },
      [nameField()],
    )
    expect(result).toEqual({ email: 'thabo@example.com', name: 'Thabo Nkosi', source: 'regex_fallback' })
  })

  it('schema_field tier also gets name enrichment', () => {
    const result = resolveIdentity(
      { applicant_email: 'jane@example.com', full_name: 'Jane Dlamini' },
      [emailField('applicant_email'), nameField()],
    )
    expect(result?.name).toBe('Jane Dlamini')
  })

  it('recipient link name is not overwritten by the schema name field', () => {
    const result = resolveIdentity(
      { full_name: 'Wrong Name' },
      [nameField()],
      'Jane Dlamini',
      'jane@example.com',
    )
    expect(result?.name).toBe('Jane Dlamini')
  })

  it('recipient link with a missing name still gets schema enrichment', () => {
    const result = resolveIdentity(
      { full_name: 'Jane Dlamini' },
      [nameField()],
      undefined,
      'jane@example.com',
    )
    expect(result?.name).toBe('Jane Dlamini')
  })

  it('excludes a company/organisation name field from the name heuristic', () => {
    const result = resolveIdentity(
      { company_name: 'Acme Corp', comments: 'contact us at info@acme.co.za' },
      [nameField('company_name', 'Company Name')],
    )
    expect(result?.name).toBeNull()
  })

  it('matches a textarea-typed name field too', () => {
    const result = resolveIdentity(
      { bio: 'Sipho Dlamini', comments: 'email me at sipho@example.com' },
      [{ key: 'bio', label: 'Your name', field_type: 'textarea', required: false, options: null }],
    )
    expect(result?.name).toBe('Sipho Dlamini')
  })

  it('leaves name null when the matched name field value is blank', () => {
    const result = resolveIdentity(
      { full_name: '   ', comments: 'reach me at thabo@example.com' },
      [nameField()],
    )
    expect(result?.name).toBeNull()
  })

  // ── Tier 4: nothing resolves ─────────────────────────────────────────────

  it('returns null when nothing resolves', () => {
    const result = resolveIdentity(
      { amount: '48500.00', notes: 'no contact info here' },
      [textField('amount')],
    )
    expect(result).toBeNull()
  })

  it('returns null for empty fields and no recipient', () => {
    expect(resolveIdentity({})).toBeNull()
  })
})
