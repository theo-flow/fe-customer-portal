import { describe, it, expect } from 'vitest'
import {
  orderFields, instructionOf, buildTasks, requirements, buildSteps, initialsFromName,
  cleanPlace, placeValueFor, validateSubmission, MAX_MARK_CHARS, MAX_TYPED_CHARS, MAX_PLACE_CHARS,
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
      [4, 2, 'The date is filled in for you', true],
    ])
    expect(buildTasks([f({ field_type: 'name' })])[0].auto).toBe(true)
  })
})

describe('what each person is asked for', () => {
  it('the customer: signature, initials and a place', () => {
    const r = requirements(customer)
    expect(r.signature).toBe(true)
    expect(r.initials).toBe(true)
    expect(r.places.map(p => p.field_id)).toEqual(['p1'])
    expect(buildSteps(customer)).toEqual(['overview', 'signature', 'initials', 'place', 'review'])
  })

  it('a witness: only a signature, so no initials or place steps', () => {
    expect(buildSteps(witness)).toEqual(['overview', 'signature', 'review'])
  })

  it('a person with only initials is not asked for a signature', () => {
    const only = [f({ field_type: 'initials' })]
    expect(requirements(only)).toMatchObject({ signature: false, initials: true })
    expect(buildSteps(only)).toEqual(['overview', 'initials', 'review'])
  })

  it('an optional box the operator marked "not required" adds no step', () => {
    const opt = [...witness, f({ field_id: 'o', field_type: 'initials', required: false })]
    expect(requirements(opt).initials).toBe(false)
    expect(buildSteps(opt)).toEqual(['overview', 'signature', 'review'])
  })

  it('an older session with no boxes for the signer still asks for a signature, as before', () => {
    expect(requirements([])).toEqual({ signature: true, initials: false, places: [] })
    expect(buildSteps([])).toEqual(['signature', 'review'])
  })

  it('date and printed name boxes never add a step of their own', () => {
    const auto = [...witness, f({ field_type: 'date' }), f({ field_type: 'name' })]
    expect(buildSteps(auto)).toEqual(['overview', 'signature', 'review'])
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
