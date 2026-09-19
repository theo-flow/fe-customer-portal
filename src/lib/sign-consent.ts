/**
 * The consent a signer gives before they sign electronically.
 *
 * The exact wording is versioned: every signature records WHICH wording the
 * person agreed to (consent_text_version), so if the wording ever changes the
 * audit trail still shows what each earlier signer was shown.
 *
 * The wording below is a first draft. It has NOT been reviewed by a lawyer:
 * whether these documents need more than this under South Africa's Electronic
 * Communications and Transactions Act (ECTA) is an open question tracked in
 * docs/PROJECT_PLAN.md (Module 12). Change the text and bump the version
 * together, never the text alone.
 */

export const CONSENT_VERSION = '2026-09-v1'

export const CONSENT_TEXT =
  'I agree to sign this document electronically. I understand that my electronic signature has the same effect as a handwritten signature.'

export const MAX_DECLINE_REASON_CHARS = 300

export interface ConsentInput {
  consent?:        unknown
  consentVersion?: unknown
}

// null when the person consented to the wording that is current.
export function consentProblem(input: ConsentInput): string | null {
  if (input.consent !== true) return 'Please confirm that you agree to sign electronically.'
  if (input.consentVersion !== CONSENT_VERSION) return 'The consent wording has changed. Please reload the page and try again.'
  return null
}

// A decline reason is free text typed by the signer and later shown to the
// person who sent the document: one plain line, no control characters, capped.
export function cleanDeclineReason(value: unknown): string {
  return (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DECLINE_REASON_CHARS)
}
