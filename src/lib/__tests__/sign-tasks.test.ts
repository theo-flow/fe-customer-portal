import { describe, it, expect } from 'vitest'
import {
  orderFields, instructionOf, buildTasks, requirements, initialsFromName, formatChosenDate,
  cleanPlace, placeValueFor, validateSubmission, MAX_MARK_CHARS, MAX_TYPED_CHARS, MAX_PLACE_CHARS,
  buildGroups, boxesOf, pagesPhrase, summariseGroups, todaySAST, dateBounds, isRealDate, dateProblem, DATE_WINDOW_DAYS,
} from '../sign-tasks'
import type { DetectedField } from '../sign'

const f = (over: Partial<DetectedField>): DetectedField => ({
  field_id: 'x', field_type: 'signature', signer_order: 1, page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.04,
  source: 'org_configured', confidence: 1, ...over,
})

// The customer's boxes on the New AOA: initials p1, signature + place + split date on p2, a name box.
const customer: DetectedField[] = [
  f({ field_id: 'd2', field_type: 'date', page: 2, y: 0.82, x: 0.5, instruction: 'The date is filled in for you' }),
  f({ field_id: 'p1', field_type: 'place', page: 2, y: 0.79, x: 0.5, instruction: 'Write where you are signing' }),
  f({ field_id: 's1', field_type: 'signature', page: 2, y: 0.79, x: 0.1, instruction: 'Sign here' }),
  f({ field_id: 'i1', field_type: 'initials', page: 1, y: 0.94, x: 0.85, instruction: 'Initial here to confirm you have read this page' }),
]

// A witness only signs.
const witness: DetectedField[] = [f({ field_id: 'w1', page: 2, y: 0.86, instruction: 'Sign as a witness' })]

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('reading the boxes', () => {
  it('orders boxes the way a person reads the document: page, then top to bottom, then left to right', () => {
    expect(orderFields(customer).map(x => x.field_id)).toEqual(['i1', 's1', 'p1', 'd2'])
  })

  it('does not change the list it is given', () => {
    const copy = [...customer]
    orderFields(customer)
    expect(customer).toEqual(copy)
  })

  it('uses the operator\'s instruction, or a plain default for an old box without one', () => {
    expect(instructionOf(f({ instruction: '  Sign as the seller  ' }))).toBe('Sign as the seller')
    expect(instructionOf(f({ instruction: undefined, field_type: 'signature' }))).toBe('Sign here')
    expect(instructionOf(f({ instruction: '   ', field_type: 'initials' }))).toBe('Initial here')
  })

  it('numbers the checklist in reading order and marks the automatic items', () => {
    const tasks = buildTasks(customer)
    expect(tasks.map(t => [t.n, t.page, t.text, t.auto])).toEqual([
      [1, 1, 'Initial here to confirm you have read this page', false],
      [2, 2, 'Sign here', false],
      [3, 2, 'Write where you are signing', false],
      [4, 2, 'The date is filled in for you', false],
    ])
    expect(buildTasks([f({ field_type: 'name' })])[0].auto).toBe(true)
  })
})

describe('what each person is asked for', () => {
  it('the customer: signature, initials, a date and a place', () => {
    const r = requirements(customer)
    expect(r.signature).toBe(true)
    expect(r.initials).toBe(true)
    expect(r.dates.map(d => d.field_id)).toEqual(['d2'])
    expect(r.places.map(p => p.field_id)).toEqual(['p1'])
  })

  it('a person with only initials is not asked for a signature', () => {
    expect(requirements([f({ field_type: 'initials' })])).toMatchObject({ signature: false, initials: true })
  })

  it('an optional box the operator marked "not required" is not required', () => {
    const opt = [...witness, f({ field_id: 'o', field_type: 'initials', required: false })]
    expect(requirements(opt).initials).toBe(false)
  })

  it('an older session with no boxes for the signer still asks for a signature, as before', () => {
    expect(requirements([])).toEqual({ signature: true, initials: false, dates: [], places: [] })
  })
})

describe('initialsFromName', () => {
  it.each([
    ['Thandi Nkosi', 'TN'],
    ['sipho dlamini-smith', 'SD'],
    ['Anele', 'A'],
    ['Jan Willem van der Merwe', 'JWV'],
    ['  ', ''],
    ['', ''],
    ['123 456', ''],
  ])('%s -> %s', (name, expected) => expect(initialsFromName(name)).toBe(expected))
})

describe('cleaning what the signer typed', () => {
  it('flattens control characters and spaces and caps the length', () => {
    expect(cleanPlace('  Cape\nTown\t ')).toBe('Cape Town')
    expect(cleanPlace('x'.repeat(500)).length).toBe(MAX_PLACE_CHARS)
    expect(cleanPlace(undefined)).toBe('')
    expect(cleanPlace(42)).toBe('')
  })

  it('reads a place answer by box id, or the older single answer for a box with no id', () => {
    expect(placeValueFor(f({ field_id: 'p1' }), { placeValues: { p1: ' Durban ' } })).toBe('Durban')
    expect(placeValueFor(f({ field_id: 'p2' }), { placeValues: { p1: 'Durban' } })).toBe('')
    expect(placeValueFor(f({ field_id: undefined }), { placeData: 'Cape Town' })).toBe('Cape Town')
  })
})

describe('validateSubmission (the server runs this, not just the page)', () => {
  const complete = {
    signatureType: 'TYPED' as const, signatureData: 'Thandi Nkosi',
    initialsType: 'TYPED' as const, initialsData: 'TN',
    placeValues: { p1: 'Cape Town' },
  }

  it('accepts a complete submission', () => {
    expect(validateSubmission(customer, complete)).toBeNull()
    expect(validateSubmission(customer, { ...complete, signatureType: 'DRAWN', signatureData: PNG, initialsType: 'DRAWN', initialsData: PNG })).toBeNull()
  })

  it('names what is missing', () => {
    expect(validateSubmission(customer, { ...complete, signatureData: undefined })).toBe('Please add your signature.')
    expect(validateSubmission(customer, { ...complete, initialsData: '  ' })).toBe('Please add your initials.')
    expect(validateSubmission(customer, { ...complete, placeValues: {} })).toBe('Please say where you are signing (page 2).')
    expect(validateSubmission(customer, { ...complete, signatureType: undefined })).toBe('Please add your signature.')
  })

  it('does not ask a witness for initials or a place', () => {
    expect(validateSubmission(witness, { signatureType: 'TYPED', signatureData: 'Sipho' })).toBeNull()
  })

  it('an older session needs just a signature', () => {
    expect(validateSubmission([], { signatureType: 'TYPED', signatureData: 'Sipho' })).toBeNull()
    expect(validateSubmission([], {})).toBe('Please add your signature.')
  })

  it('an older box with no id takes the single place answer', () => {
    const old = [f({ field_id: undefined, field_type: 'signature' }), f({ field_id: undefined, field_type: 'place' })]
    expect(validateSubmission(old, { signatureType: 'TYPED', signatureData: 'A' })).toBe('Please say where you are signing (page 1).')
    expect(validateSubmission(old, { signatureType: 'TYPED', signatureData: 'A', placeData: 'Cape Town' })).toBeNull()
  })

  it('rejects a drawn mark that is not a PNG image, or is far too big', () => {
    expect(validateSubmission(witness, { signatureType: 'DRAWN', signatureData: 'data:text/html;base64,PGI+' })).toMatch(/could not be read/)
    expect(validateSubmission(witness, { signatureType: 'DRAWN', signatureData: 'not a data url' })).toMatch(/could not be read/)
    expect(validateSubmission(witness, { signatureType: 'DRAWN', signatureData: 'data:image/png;base64,' + 'A'.repeat(MAX_MARK_CHARS) })).toMatch(/could not be read/)
  })

  it('rejects a typed mark that is too long, and an unknown type', () => {
    expect(validateSubmission(witness, { signatureType: 'TYPED', signatureData: 'x'.repeat(MAX_TYPED_CHARS + 1) })).toBe('Your signature is too long.')
    expect(validateSubmission(witness, { signatureType: 'SCRIBBLE' as never, signatureData: 'A' })).toBe('Please add your signature.')
  })

  it('a signature that was not required is still checked if it was sent', () => {
    const initialsOnly = [f({ field_type: 'initials' })]
    expect(validateSubmission(initialsOnly, { initialsType: 'TYPED', initialsData: 'TN', signatureType: 'TYPED', signatureData: '' })).toBe('Please add your signature.')
    expect(validateSubmission(initialsOnly, { initialsType: 'TYPED', initialsData: 'TN' })).toBeNull()
  })

  it('a place answer of only spaces counts as missing', () => {
    expect(validateSubmission(customer, { ...complete, placeValues: { p1: '   ' } })).toBe('Please say where you are signing (page 2).')
  })
})


describe('groups: one kind of thing at a time, done once for every box of that kind', () => {
  it('the customer is asked for a signature, initials, the date and where they signed, in that order', () => {
    expect(buildGroups(customer)).toEqual(['signature', 'initials', 'date', 'place'])
  })

  it('a witness only signs', () => {
    expect(buildGroups(witness)).toEqual(['signature'])
  })

  it('a kind with only optional boxes is skipped, and a form with no boxes at all asks for a signature', () => {
    expect(buildGroups([f({ field_type: 'initials', required: false }), f({ field_id: 'q' })])).toEqual(['signature'])
    expect(buildGroups([])).toEqual(['signature'])
  })

  it('the printed name never becomes a task, it is filled in', () => {
    expect(buildGroups([...witness, f({ field_type: 'name' })])).toEqual(['signature'])
  })

  it('finds every box of a kind in reading order, across pages', () => {
    const many = [f({ field_id: 'c', field_type: 'initials', page: 3 }), f({ field_id: 'a', field_type: 'initials', page: 1 }), f({ field_id: 'b', field_type: 'initials', page: 2 }), f({ field_id: 'z' })]
    expect(boxesOf(many, 'initials').map(x => x.field_id)).toEqual(['a', 'b', 'c'])
  })

  it.each([
    [[], 'the document'],
    [[f({ page: 2 })], 'page 2'],
    [[f({ page: 2 }), f({ page: 1 })], 'pages 1 and 2'],
    [[f({ page: 3 }), f({ page: 1 }), f({ page: 2 }), f({ page: 2 })], 'pages 1, 2 and 3'],
  ])('describes the pages plainly', (fields, text) => expect(pagesPhrase(fields)).toBe(text))

  it('writes the checklist a person reads first, one line per kind of task', () => {
    const many = [...customer, f({ field_id: 'i2', field_type: 'initials', page: 2 }), f({ field_id: 'i3', field_type: 'initials', page: 3 })]
    expect(summariseGroups(many).map(x => x.text)).toEqual([
      'Sign on page 2',
      'Initial on pages 1, 2 and 3',
      'Choose the date, it is written on page 2',
      'Write where you are signing, on page 2',
    ])
  })

  it('an older session is simply asked to sign', () => {
    expect(summariseGroups([])).toEqual([{ group: 'signature', text: 'Sign the document' }])
  })
})

describe('the date the signer chooses', () => {
  const noon = (iso: string) => new Date(`${iso}T12:00:00+02:00`)

  it('today is the South African day, not the UTC day', () => {
    expect(todaySAST(new Date('2026-09-19T10:00:00Z'))).toBe('2026-09-19')
    expect(todaySAST(new Date('2026-09-19T22:30:00Z'))).toBe('2026-09-20')   // already tomorrow in South Africa
    expect(todaySAST(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
  })

  it('may go back a limited number of days and never forward', () => {
    const b = dateBounds(noon('2026-09-19'))
    expect(b.max).toBe('2026-09-19')
    expect(b.min).toBe('2026-08-20')
    expect(DATE_WINDOW_DAYS).toBe(30)
  })

  it('the window crosses a year end correctly', () => {
    expect(dateBounds(noon('2027-01-10')).min).toBe('2026-12-11')
  })

  it.each([['2026-02-30', false], ['2026-13-01', false], ['26-09-19', false], ['19 September', false], ['', false], ['2026-09-19', true], ['2028-02-29', true]])(
    'isRealDate(%s) is %s', (iso, ok) => expect(isRealDate(iso)).toBe(ok))

  it('accepts today, yesterday and the oldest allowed day', () => {
    const now = noon('2026-09-19')
    expect(dateProblem('2026-09-19', now)).toBeNull()
    expect(dateProblem('2026-09-18', now)).toBeNull()
    expect(dateProblem('2026-08-20', now)).toBeNull()
  })

  it('refuses tomorrow, too old, and anything that is not a date', () => {
    const now = noon('2026-09-19')
    expect(dateProblem('2026-09-20', now)).toBe('The date cannot be in the future.')
    expect(dateProblem('2026-08-19', now)).toBe('The date cannot be more than 30 days ago.')
    expect(dateProblem('2026-02-30', now)).toBe('Please choose a valid date.')
    expect(dateProblem(undefined, now)).toBe('Please choose a valid date.')
    expect(dateProblem(20260919, now)).toBe('Please choose a valid date.')
  })

  it('is optional in a submission, but checked when it is sent', () => {
    const base = { signatureType: 'TYPED' as const, signatureData: 'Sipho' }
    expect(validateSubmission(witness, base)).toBeNull()
    expect(validateSubmission(witness, { ...base, signingDate: todaySAST() })).toBeNull()
    expect(validateSubmission(witness, { ...base, signingDate: '2999-01-01' })).toBe('The date cannot be in the future.')
    expect(validateSubmission(witness, { ...base, signingDate: 'yesterday' })).toBe('Please choose a valid date.')
  })
})


describe('formatChosenDate (what the signer sees in the box)', () => {
  it.each([
    ['2026-09-17', 'day_month', '17 September'],
    ['2026-09-07', 'day_month', '7 September'],
    ['2026-09-17', 'year_2', '26'],
    ['2009-06-01', 'year_2', '09'],
    ['2026-09-17', 'year_4', '2026'],
    ['2026-09-17', 'long', '17 September 2026'],
    ['2026-09-17', 'iso', '2026-09-17'],
    ['2026-09-17', undefined, '2026-09-17'],
  ])('%s as %s is %s', (iso, format, expected) => expect(formatChosenDate(iso, format)).toBe(expected))

  it('shows nothing for something that is not a date', () => {
    expect(formatChosenDate('', 'day_month')).toBe('')
    expect(formatChosenDate('2026-02-30', 'day_month')).toBe('')
    expect(formatChosenDate('nonsense', 'long')).toBe('')
  })
})
