import { describe, it, expect } from 'vitest'
import { matchForm, suggestForm, type FormSummary, type UploadInfo } from '../sign-form-match'

const aoa: FormSummary = {
  formId: 'aoa', name: 'New AOA', pageCount: 3, pageWidth: 595.32, pageHeight: 841.92,
  roles: ['Customer', 'Witness 1', 'Witness 2', 'Seller'],
  anchors: [
    { page: 1, text: 'AMENDMENT OF AGREEMENT' },
    { page: 2, text: 'In presence of the undersigned witnesses' },
    { page: 3, text: 'Witness for consumer' },
  ],
}

// Another 3-page A4 form from the same company: same shape, different content.
const consent: FormSummary = {
  formId: 'consent', name: 'Consent', pageCount: 3, pageWidth: 595.32, pageHeight: 841.92,
  roles: ['Customer'],
  anchors: [
    { page: 1, text: 'CONSENT TO CREDIT CHECK' },
    { page: 3, text: 'Signature of consumer' },
  ],
}

// A different customer's copy of the AOA: other name, ID and amounts, same furniture.
const aoaUpload = (over: Partial<UploadInfo> = {}): UploadInfo => ({
  pageCount: 3, pageWidth: 595.32, pageHeight: 841.92,
  pageTexts: [
    'AMENDMENT OF AGREEMENT: 777 111 222 ("THE AGREEMENT") Between: The Standard Bank of South Africa Limited and THANDI NKOSI ID Number: 8801015800086 monthly instalment of R14 500.00',
    '3.1.6. First instalment due date ... Signed at on 20 In presence of the undersigned witnesses As Witness Seller',
    'Witness for consumer Confirmed Contact Details Customer 1 Name Surname',
  ],
  ...over,
})

describe('matchForm', () => {
  it('matches a different customer\'s copy of the same form', () => {
    const r = matchForm(aoaUpload(), aoa)
    expect(r).toMatchObject({ status: 'match', problems: [], anchorsFound: 3, anchorsTotal: 3 })
  })

  it('is not thrown by capitalisation, punctuation or split words', () => {
    const r = matchForm(aoaUpload({ pageTexts: [
      'amendment of  AGREEMENT',
      'in presence of the under signed witnesses',
      'WITNESS FOR CONSUMER',
    ] }), aoa)
    expect(r.status).toBe('match')
  })

  it('is a hard mismatch when the page count differs, and says so', () => {
    const r = matchForm(aoaUpload({ pageCount: 4, pageTexts: ['a', 'b', 'c', 'd'] }), aoa)
    expect(r.status).toBe('mismatch')
    expect(r.problems[0]).toBe('This document has 4 pages, but New AOA has 3.')
  })

  it('handles the singular in the message', () => {
    const r = matchForm(aoaUpload({ pageCount: 1, pageTexts: ['a'] }), aoa)
    expect(r.problems[0]).toBe('This document has 1 page, but New AOA has 3.')
  })

  it('is a hard mismatch when the page size differs (Letter instead of A4)', () => {
    const r = matchForm(aoaUpload({ pageWidth: 612, pageHeight: 792 }), aoa)
    expect(r.status).toBe('mismatch')
    expect(r.problems.join(' ')).toContain('page size')
  })

  it('tolerates tiny page size differences from different PDF producers', () => {
    expect(matchForm(aoaUpload({ pageWidth: 595.0, pageHeight: 842.0 }), aoa).status).toBe('match')
  })

  it('is unsure, not matching, when only some phrases are found', () => {
    const r = matchForm(aoaUpload({ pageTexts: [
      'AMENDMENT OF AGREEMENT', 'In presence of the undersigned witnesses', 'a page with different wording',
    ] }), aoa)
    expect(r.status).toBe('unsure')
    expect(r.anchorsFound).toBe(2)
    expect(r.problems[0]).toBe('Page 3 does not contain "Witness for consumer".')
  })

  it('is a mismatch when most phrases are missing', () => {
    const r = matchForm(aoaUpload({ pageTexts: ['other', 'other', 'other'] }), aoa)
    expect(r.status).toBe('mismatch')
  })

  it('looks for each phrase on its own page, not anywhere in the document', () => {
    // right words, wrong pages
    const r = matchForm(aoaUpload({ pageTexts: [
      'Witness for consumer', 'AMENDMENT OF AGREEMENT', 'In presence of the undersigned witnesses',
    ] }), aoa)
    expect(r.status).not.toBe('match')
  })

  it('is unsure, with a reason, when the form has no recognition phrases', () => {
    const r = matchForm(aoaUpload(), { ...aoa, anchors: [] })
    expect(r.status).toBe('unsure')
    expect(r.problems[0]).toContain('no recognition phrases')
  })

  it('lists at most three missing phrases and counts the rest', () => {
    const many: FormSummary = { ...aoa, anchors: Array.from({ length: 8 }, (_, i) => ({ page: 1, text: `Missing phrase number ${'z'.repeat(i + 1)}` })) }
    const r = matchForm(aoaUpload({ pageTexts: ['nothing', 'nothing', 'nothing'] }), many)
    expect(r.problems).toHaveLength(4)
    expect(r.problems[3]).toBe('And 5 more phrases were not found.')
  })

  it('does not throw when the upload has fewer pages of text than the form expects', () => {
    expect(() => matchForm(aoaUpload({ pageTexts: [] }), aoa)).not.toThrow()
  })
})

describe('suggestForm', () => {
  it('picks the right form of two same-shaped ones, from the wording alone', () => {
    const { suggested, results } = suggestForm(aoaUpload(), [consent, aoa])
    expect(suggested?.formId).toBe('aoa')
    expect(results.consent.status).toBe('mismatch')
    expect(results.aoa.status).toBe('match')
  })

  it('suggests nothing when two forms both match', () => {
    const twin = { ...aoa, formId: 'aoa2', name: 'New AOA copy' }
    expect(suggestForm(aoaUpload(), [aoa, twin]).suggested).toBeNull()
  })

  it('suggests nothing when none matches, so the person has to choose', () => {
    const { suggested } = suggestForm(aoaUpload({ pageTexts: ['x', 'y', 'z'] }), [aoa, consent])
    expect(suggested).toBeNull()
  })

  it('does not suggest an unsure form', () => {
    const { suggested } = suggestForm(aoaUpload(), [{ ...aoa, anchors: [] }])
    expect(suggested).toBeNull()
  })

  it('handles a customer with no forms', () => {
    expect(suggestForm(aoaUpload(), [])).toEqual({ suggested: null, results: {} })
  })
})
