import { describe, it, expect } from 'vitest'
import { CONSENT_TEXT, CONSENT_VERSION, MAX_DECLINE_REASON_CHARS, cleanDeclineReason, consentProblem } from '../sign-consent'

describe('consent', () => {
  it('is satisfied only by an explicit yes to the current wording', () => {
    expect(consentProblem({ consent: true, consentVersion: CONSENT_VERSION })).toBeNull()
  })

  it.each([
    ['nothing sent', {}],
    ['false', { consent: false, consentVersion: CONSENT_VERSION }],
    ['the string "true"', { consent: 'true', consentVersion: CONSENT_VERSION }],
    ['1', { consent: 1, consentVersion: CONSENT_VERSION }],
    ['null', { consent: null, consentVersion: CONSENT_VERSION }],
  ])('is not satisfied by %s', (_l, input) => {
    expect(consentProblem(input)).toBe('Please confirm that you agree to sign electronically.')
  })

  it('is not satisfied by the wording of a different version, so a stale page cannot record the wrong consent', () => {
    expect(consentProblem({ consent: true, consentVersion: 'old-version' })).toMatch(/wording has changed/)
    expect(consentProblem({ consent: true })).toMatch(/wording has changed/)
  })

  it('has wording that says what is being agreed, in plain words with no long dash', () => {
    expect(CONSENT_TEXT).toContain('electronically')
    expect(CONSENT_TEXT).toContain('handwritten')
    expect(CONSENT_TEXT).not.toContain(String.fromCharCode(0x2014))
    expect(CONSENT_TEXT).not.toContain('--')
    expect(CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-v\d+$/)
  })
})

describe('cleanDeclineReason', () => {
  it('keeps a normal reason, tidied to one line', () => {
    expect(cleanDeclineReason('  I do not agree\nwith clause 3.  ')).toBe('I do not agree with clause 3.')
  })

  it('caps the length', () => {
    expect(cleanDeclineReason('x'.repeat(2000)).length).toBe(MAX_DECLINE_REASON_CHARS)
  })

  it.each([[undefined], [null], [42], [{}], ['   '], ['']])('gives an empty reason for %s', v => {
    expect(cleanDeclineReason(v)).toBe('')
  })
})
