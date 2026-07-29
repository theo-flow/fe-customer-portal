// TypeScript counterpart to shared/identity/resolve.py in daai-insure-platform
// -- same priority logic, kept in sync deliberately rather than shared,
// since the portal and the backend Lambdas are separate codebases that
// can't literally import each other's modules (same reasoning as
// src/lib/hub-events.ts mirroring shared/events/publisher.py).
//
// Resolves a submission's email/name from, in priority order: a tracked
// RecipientLink's captured identity, a schema field typed "email", a regex
// fallback over field values, or null -- "can't identify this submitter" is
// a valid outcome, not an error.
//
// Name resolution is independent of which email tier fired (confirmed
// necessary by a live end-to-end test, 2026-07-28: an org-direct-share
// Harvest submission -- no RecipientLink at all -- had a real "Full name"
// field that was silently discarded because name resolution used to only
// ever come from the recipient-link tier). There is no dedicated name/
// surname field type anywhere in the schema system, so this is a label-
// keyword heuristic -- v1, confirm against real forms before relying on it
// further.
import type { Field as SchemaField } from '@/components/FieldInput'

// Deliberately permissive -- this is a "does this look like an email" check
// over OCR'd/user-typed text, not RFC 5322 validation.
const EMAIL_PATTERN = String.raw`[\w.+-]+@[\w-]+\.[\w.-]+`
const EMAIL_RE = new RegExp(EMAIL_PATTERN)
const EMAIL_FULLMATCH_RE = new RegExp(`^${EMAIL_PATTERN}$`)

// A text field whose label mentions "name" is a name candidate, unless
// it's clearly a company/organisation name rather than a person's --
// "Company Name"/"Business Name"/"Organisation Name" must not be mistaken
// for who submitted the form.
const NAME_LABEL_RE = /\bname\b/i
const NAME_EXCLUDE_RE = /\b(company|business|organisation|organization|org)\b/i

export interface ResolvedIdentity {
  email: string
  name: string | null
  source: 'recipient_link' | 'schema_field' | 'regex_fallback'
}

/**
 * fields: the submission's field-value bag -- Harvest's `values` or
 *   Decode's extracted `fields`, keyed by the schema field's `key`.
 * schemaFields: the FormSchema's fields, used to find which key (if any)
 *   is typed "email", and (independently) which text field looks like a
 *   name field. Omit if unavailable.
 * recipientName / recipientEmail: already-resolved RecipientLink identity,
 *   if the caller has one. Harvest submissions carry this denormalized on
 *   the item already (recipient_name/recipient_email) when the submitter
 *   came through a tokenized invite link; Decode never has one -- it
 *   processes already-filled paper documents, there's no per-recipient
 *   link concept there at all.
 */
export function resolveIdentity(
  fields: Record<string, unknown>,
  schemaFields?: SchemaField[] | null,
  recipientName?: string | null,
  recipientEmail?: string | null,
): ResolvedIdentity | null {
  const identity =
    fromRecipientLink(recipientName, recipientEmail) ??
    fromSchemaEmailField(fields, schemaFields) ??
    fromRegexFallback(fields)

  if (!identity) return null

  if (identity.name === null) {
    identity.name = fromSchemaNameField(fields, schemaFields)
  }
  return identity
}

function fromRecipientLink(name?: string | null, email?: string | null): ResolvedIdentity | null {
  if (!email || !email.trim()) return null
  return {
    email: email.trim(),
    name: name && name.trim() ? name.trim() : null,
    source: 'recipient_link',
  }
}

function fromSchemaEmailField(
  fields: Record<string, unknown>,
  schemaFields?: SchemaField[] | null,
): ResolvedIdentity | null {
  if (!schemaFields || schemaFields.length === 0) return null
  for (const field of schemaFields) {
    if (field.field_type !== 'email') continue
    const value = fields[field.key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (EMAIL_FULLMATCH_RE.test(trimmed)) {
      return { email: trimmed, name: null, source: 'schema_field' }
    }
  }
  return null
}

function fromRegexFallback(fields: Record<string, unknown>): ResolvedIdentity | null {
  for (const value of Object.values(fields)) {
    if (typeof value !== 'string') continue
    const match = value.match(EMAIL_RE)
    if (match) return { email: match[0], name: null, source: 'regex_fallback' }
  }
  return null
}

function fromSchemaNameField(
  fields: Record<string, unknown>,
  schemaFields?: SchemaField[] | null,
): string | null {
  if (!schemaFields || schemaFields.length === 0) return null
  for (const field of schemaFields) {
    if (field.field_type !== 'text' && field.field_type !== 'textarea') continue
    if (!NAME_LABEL_RE.test(field.label) || NAME_EXCLUDE_RE.test(field.label)) continue
    const value = fields[field.key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}
