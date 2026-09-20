import { describe, it, expect } from 'vitest'
import {
  normalizeText, squash, pageTextFromItems, linesFromItems, fixedWording, suggestAnchors, mergeAnchors,
  type PdfTextItem,
} from '../pdf-text'

const H = 842   // A4 height in points
const item = (str: string, x: number, y: number): PdfTextItem => ({ str, transform: [1, 0, 0, 1, x, y] })

describe('normalizeText / squash', () => {
  it('lower-cases and keeps only letters, digits and single spaces', () => {
    expect(normalizeText('  AMENDMENT of Agreement:  ("THE AGREEMENT") ')).toBe('amendment of agreement the agreement')
  })
  it('squash also drops spaces so split or joined words still compare equal', () => {
    expect(squash('Witness for consumer')).toBe(squash('Wit ness  forconsumer'))
  })
})

describe('linesFromItems', () => {
  it('groups items sharing a baseline into one line, read left to right, top to bottom', () => {
    const lines = linesFromItems([
      item('witnesses', 300, 200), item('In presence of the undersigned', 90, 200),
      item('Signed', 90, 250), item('at', 300, 250.8),   // same baseline within tolerance
      item('AMENDMENT OF AGREEMENT', 200, 780),
    ], H)
    expect(lines.map(l => l.text)).toEqual([
      'AMENDMENT OF AGREEMENT',
      'Signed at',
      'In presence of the undersigned witnesses',
    ])
    expect(lines[0].y).toBeLessThan(lines[1].y)   // y counts down from the top of the page
    expect(lines[0].y).toBeCloseTo(1 - 780 / H, 5)
  })

  it('ignores empty and whitespace-only items', () => {
    expect(linesFromItems([item('', 10, 10), item('   ', 10, 10)], H)).toEqual([])
  })
})

describe('pageTextFromItems', () => {
  it('joins everything with single spaces', () => {
    expect(pageTextFromItems([item('Witness', 1, 1), item('for  consumer', 2, 2)])).toBe('Witness for consumer')
  })
})

describe('fixedWording (what stays the same on every copy of the form)', () => {
  it('drops the variable agreement number and keeps the heading words', () => {
    expect(fixedWording('AMENDMENT OF AGREEMENT: 533 323 703 ("THE AGREEMENT")')).toBe('AMENDMENT OF AGREEMENT')
  })
  it('turns fill-in blanks into gaps', () => {
    expect(fixedWording('Signed ______________ at ______________ on')).toBe('Signed at on')
    expect(fixedWording('As Witness ____________  Seller____________')).toBe('As Witness Seller')
  })
  it('rejects amounts, dates, IDs and anything too short to identify a form', () => {
    expect(fixedWording('R23 062.01')).toBe('')
    expect(fixedWording('8801015800086')).toBe('')
    expect(fixedWording('Date')).toBe('')
    expect(fixedWording('2026/09/19')).toBe('')
    expect(fixedWording('')).toBe('')
  })
  it('never returns more than the phrase limit', () => {
    expect(fixedWording('word '.repeat(60)).length).toBeLessThanOrEqual(80)
  })
})

describe('suggestAnchors', () => {
  // AOA-like: title on page 1, signature labels on page 2, initials box added bottom right of page 1
  const pages = [
    { page: 1, lines: [
      { y: 0.16, text: 'AMENDMENT OF AGREEMENT: 533 323 703 ("THE AGREEMENT")' },
      { y: 0.25, text: 'THANDI NKOSI' },                 // a person: variable content
      { y: 0.6,  text: 'R23 062.01 over a period of ____ months.' },
    ] },
    { page: 2, lines: [
      { y: 0.5,  text: 'Payment shall be made into the following account:' },   // far from any box
      { y: 0.78, text: 'Signed ______________ at ______________ on' },
      { y: 0.83, text: 'In presence of the undersigned witnesses' },
      { y: 0.9,  text: 'As Witness ____________  Seller____________' },
    ] },
    { page: 3, lines: [{ y: 0.05, text: 'Witness for consumer' }] },
  ]
  const boxes = [
    { page: 2, y: 0.775, height: 0.03 },   // signature on the "Signed" line
    { page: 2, y: 0.895, height: 0.03 },   // witness / seller line
    { page: 3, y: 0.04,  height: 0.04 },   // witness for consumer
  ]

  it('proposes the title and the labels beside the boxes, never names or amounts', () => {
    const out = suggestAnchors(pages, boxes)
    expect(out).toEqual(expect.arrayContaining([
      { page: 1, text: 'AMENDMENT OF AGREEMENT' },
      { page: 2, text: 'Signed at on' },
      { page: 2, text: 'As Witness Seller' },
      { page: 3, text: 'Witness for consumer' },
    ]))
    const texts = out.map(a => a.text.toLowerCase())
    expect(texts.some(t => t.includes('nkosi'))).toBe(false)     // page 1 second line is not near a box
    expect(texts.some(t => t.includes('payment shall'))).toBe(false)
    expect(out.every(a => !/\d/.test(a.text))).toBe(true)
  })

  it('does not repeat a phrase', () => {
    const twice = [{ page: 1, lines: [{ y: 0.1, text: 'AMENDMENT OF AGREEMENT' }] }]
    const out = suggestAnchors(twice, [{ page: 1, y: 0.09, height: 0.03 }])
    expect(out).toHaveLength(1)
  })

  it('caps the number of suggestions', () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({ y: 0.5 + i * 0.001, text: `Label number ${'x'.repeat(i + 2)} here` }))
    expect(suggestAnchors([{ page: 1, lines }], [{ page: 1, y: 0.5, height: 0.03 }], 5).length).toBeLessThanOrEqual(5)
  })

  it('suggests nothing when there are no boxes and no usable title', () => {
    expect(suggestAnchors([{ page: 2, lines: [{ y: 0.5, text: 'Some clause text here' }] }], [])).toEqual([])
  })
})


describe('mergeAnchors', () => {
  it('keeps what the operator already has and adds only new phrases', () => {
    const out = mergeAnchors(
      [{ page: 1, text: 'My own phrase here' }],
      [{ page: 1, text: 'AMENDMENT OF AGREEMENT' }, { page: 2, text: 'Signed at on' }],
    )
    expect(out.map(a => a.text)).toEqual(['My own phrase here', 'AMENDMENT OF AGREEMENT', 'Signed at on'])
  })

  it('skips a phrase already on the same page however it is spaced or capitalised', () => {
    const out = mergeAnchors([{ page: 2, text: 'signed  AT on' }], [{ page: 2, text: 'Signed at on' }])
    expect(out).toHaveLength(1)
  })

  it('treats the same wording on a different page as a different phrase', () => {
    expect(mergeAnchors([{ page: 1, text: 'Signed at on' }], [{ page: 2, text: 'Signed at on' }])).toHaveLength(2)
  })

  it('never grows past the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ page: 1, text: `Phrase number ${'q'.repeat(i + 1)}` }))
    expect(mergeAnchors([], many).length).toBeLessThanOrEqual(12)
  })
})
