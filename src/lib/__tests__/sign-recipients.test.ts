import { describe, it, expect } from 'vitest'
import {
  textInRegion, cleanName, cleanEmail, readRecipients, suggestPeople,
  type PositionedItem, type ReadBox,
} from '../sign-recipients'

const W = 595.32
const H = 841.92

// An item whose top edge sits `top` (0 to 1) down the page, starting `left` across it.
const at = (str: string, left: number, top: number, width = 120, height = 10): PositionedItem => ({
  str, width, height,
  // baseline: PDF y counts up from the bottom; the item's centre must land at `top`
  transform: [1, 0, 0, 1, left * W, (1 - top) * H - height / 2],
})

// Page 1 of an AOA-like form: title, who it is between, the customer, their ID, a clause
const page1: PositionedItem[] = [
  at('AMENDMENT OF AGREEMENT', 0.25, 0.17, 300),
  at('Between:', 0.13, 0.22, 60),
  at('The Standard Bank of South Africa', 0.32, 0.22, 200),
  at('and', 0.13, 0.31, 30),
  at('THANDI', 0.32, 0.34, 60),
  at('NKOSI', 0.42, 0.34, 60),        // one name split across two text items
  at('ID Number:', 0.32, 0.37, 70),
  at('8801015800086', 0.42, 0.37, 90),
  at('("the customer")', 0.32, 0.40, 100),
  at('The monthly instalment of R23 062.01', 0.13, 0.62, 300),
]
const pageItems = [page1, [at('Signed', 0.13, 0.78, 50)], []]

const nameBox: ReadBox = { role: 'Customer', kind: 'name', page: 1, x: 0.30, y: 0.33, width: 0.30, height: 0.03 }
const emailBox: ReadBox = { role: 'Customer', kind: 'email', page: 1, x: 0.30, y: 0.50, width: 0.40, height: 0.03 }

describe('textInRegion', () => {
  it('reads only what sits inside the box, joining items on the same line in order', () => {
    expect(textInRegion(page1, nameBox, W, H)).toBe('THANDI NKOSI')
  })

  it('leaves out text just above and below the box', () => {
    const text = textInRegion(page1, nameBox, W, H)
    expect(text).not.toContain('and')
    expect(text).not.toContain('ID Number')
  })

  it('reads several lines top to bottom', () => {
    const tall: ReadBox = { ...nameBox, y: 0.33, height: 0.09 }
    expect(textInRegion(page1, tall, W, H)).toBe('THANDI NKOSI ID Number: 8801015800086 ("the customer")')
  })

  it('returns nothing for an empty region, an empty page, or blank items', () => {
    expect(textInRegion(page1, { ...nameBox, y: 0.9 }, W, H)).toBe('')
    expect(textInRegion([], nameBox, W, H)).toBe('')
    expect(textInRegion([at('   ', 0.32, 0.34)], nameBox, W, H)).toBe('')
  })
})

describe('cleanName', () => {
  it.each([
    ['THANDI NKOSI', 'Thandi Nkosi'],
    ['Thandi Nkosi', 'Thandi Nkosi'],
    ['  thandi   nkosi ', 'thandi nkosi'],               // mixed or lower case is left alone
    ['SIPHO DLAMINI-SMITH', 'Sipho Dlamini-Smith'],
    ["ANELE O'BRIEN", "Anele O'Brien"],
    ['Name: Thandi Nkosi', 'Thandi Nkosi'],
    ['Full name - Thandi Nkosi', 'Thandi Nkosi'],
    ['Surname: NKOSI', 'Nkosi'],
    ['Thandi Nkosi ________', 'Thandi Nkosi'],
    ['Thandi Nkosi ....', 'Thandi Nkosi'],
  ])('%s -> %s', (raw, expected) => expect(cleanName(raw)).toBe(expected))

  it.each([
    ['digits', 'Thandi 12'],
    ['an ID number', '8801015800086'],
    ['an amount', 'R23 062.01'],
    ['too short', 'T'],
    ['only a label', 'Name:'],
    ['blanks only', '________'],
    ['empty', ''],
  ])('gives nothing for %s rather than guessing', (_l, raw) => expect(cleanName(raw)).toBe(''))

  it('caps the length', () => {
    expect(cleanName('A'.repeat(300)).length).toBeLessThanOrEqual(100)
  })
})

describe('cleanEmail', () => {
  it('finds the address inside surrounding text and lower-cases it', () => {
    expect(cleanEmail('Email: Thandi.Nkosi@Example.CO.ZA please')).toBe('thandi.nkosi@example.co.za')
    expect(cleanEmail('t+form@example.com')).toBe('t+form@example.com')
  })
  it('gives nothing when there is no address', () => {
    expect(cleanEmail('no email here')).toBe('')
    expect(cleanEmail('thandi@')).toBe('')
    expect(cleanEmail('')).toBe('')
  })
})

describe('readRecipients', () => {
  it('reads the customer\'s name from the document', () => {
    expect(readRecipients(pageItems, W, H, [nameBox])).toEqual({ Customer: { name: 'Thandi Nkosi' } })
  })

  it('leaves out an email that is not on the form, and keeps the name', () => {
    const out = readRecipients(pageItems, W, H, [nameBox, emailBox])
    expect(out).toEqual({ Customer: { name: 'Thandi Nkosi' } })
  })

  it('reads an email when the form prints one', () => {
    const withEmail = [[...page1, at('thandi@example.com', 0.32, 0.51, 150)], [], []]
    expect(readRecipients(withEmail, W, H, [nameBox, emailBox])).toEqual({ Customer: { name: 'Thandi Nkosi', email: 'thandi@example.com' } })
  })

  it('reads a different person for another role from another spot', () => {
    const witness: ReadBox = { role: 'Witness 1', kind: 'name', page: 2, x: 0.10, y: 0.77, width: 0.2, height: 0.03 }
    const out = readRecipients([page1, [at('Sipho Dlamini', 0.12, 0.78, 100)], []], W, H, [nameBox, witness])
    expect(out).toEqual({ Customer: { name: 'Thandi Nkosi' }, 'Witness 1': { name: 'Sipho Dlamini' } })
  })

  it('ignores a box on a page the document does not have, and text that is not a name', () => {
    expect(readRecipients(pageItems, W, H, [{ ...nameBox, page: 9 }])).toEqual({})
    expect(readRecipients(pageItems, W, H, [{ ...nameBox, y: 0.365, height: 0.02 }])).toEqual({})   // lands on the ID number
  })

  it('takes the first name it finds for a role', () => {
    const second: ReadBox = { ...nameBox, y: 0.61, height: 0.03 }
    expect(readRecipients(pageItems, W, H, [nameBox, second])).toEqual({ Customer: { name: 'Thandi Nkosi' } })
  })
})

describe('suggestPeople', () => {
  const roles = ['Customer', 'Witness 1', 'Seller']
  const defaults = [{ role: 'Seller', name: 'Anele Botha', email: 'anele@bank.example' }]

  it('what was read from the document wins, then the fixed default, otherwise blank', () => {
    const out = suggestPeople(roles, { Customer: { name: 'Thandi Nkosi' } }, defaults)
    expect(out.Customer).toEqual({ name: 'Thandi Nkosi', email: '', nameFrom: 'document', emailFrom: null })
    expect(out['Witness 1']).toEqual({ name: '', email: '', nameFrom: null, emailFrom: null })
    expect(out.Seller).toEqual({ name: 'Anele Botha', email: 'anele@bank.example', nameFrom: 'default', emailFrom: 'default' })
  })

  it('mixes sources per field: name from the document, email from the default', () => {
    const out = suggestPeople(['Customer'], { Customer: { name: 'Thandi Nkosi' } }, [{ role: 'Customer', name: 'Someone Else', email: 'default@example.com' }])
    expect(out.Customer).toEqual({ name: 'Thandi Nkosi', email: 'default@example.com', nameFrom: 'document', emailFrom: 'default' })
  })

  it('handles no defaults and nothing read', () => {
    const out = suggestPeople(roles, {}, [])
    for (const role of roles) expect(out[role]).toEqual({ name: '', email: '', nameFrom: null, emailFrom: null })
  })
})
