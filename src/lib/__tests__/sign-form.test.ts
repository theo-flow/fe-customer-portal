import { describe, it, expect } from 'vitest'
import {
  cleanInstruction, clampBox, newField, repeatOnAllPages, removeRole, renameRole,
  describeField, fieldsByPage, validateLayout, DEFAULT_INSTRUCTIONS, MAX_INSTRUCTION_CHARS, isReadType,
  type FormField, type FormLayout,
} from '../sign-form'

const box = (over: Partial<FormField> = {}): FormField => ({
  field_id: 'f1', field_type: 'signature', role: 'Customer', page: 1,
  x: 0.1, y: 0.1, width: 0.3, height: 0.05, instruction: 'Sign here', required: true, ...over,
})

// The New AOA from the worked example: 3 pages, four roles.
function newAoa(): FormLayout {
  return {
    name: 'New AOA', page_count: 3, page_width: 595.32, page_height: 841.92,
    roles: ['Customer', 'Witness 1', 'Witness 2', 'Seller'],
    anchors: [], role_defaults: [],
    fields: [
      box({ field_id: 'i1', field_type: 'initials', page: 1, x: 0.85, y: 0.94, width: 0.1, height: 0.04, instruction: 'Initial here to confirm you have read this page' }),
      box({ field_id: 's1', page: 2, x: 0.13, y: 0.79, width: 0.28, height: 0.03 }),
      box({ field_id: 'p1', field_type: 'place', page: 2, x: 0.45, y: 0.79, width: 0.4, height: 0.03 }),
      box({ field_id: 'd1', field_type: 'date', date_format: 'day_month', page: 2, x: 0.1, y: 0.82, width: 0.3, height: 0.03 }),
      box({ field_id: 'd2', field_type: 'date', date_format: 'year_2', page: 2, x: 0.45, y: 0.82, width: 0.06, height: 0.03 }),
      box({ field_id: 'w1', role: 'Witness 1', page: 2, x: 0.28, y: 0.86, width: 0.22, height: 0.03 }),
      box({ field_id: 'w2', role: 'Witness 2', page: 2, x: 0.28, y: 0.9, width: 0.22, height: 0.03 }),
      box({ field_id: 'sl', role: 'Seller', page: 2, x: 0.6, y: 0.86, width: 0.25, height: 0.03 }),
      box({ field_id: 'w3', role: 'Witness 1', page: 3, x: 0.3, y: 0.05, width: 0.25, height: 0.04 }),
    ],
  }
}

describe('cleanInstruction', () => {
  it('falls back to a plain default per type when empty or not text', () => {
    expect(cleanInstruction('', 'initials')).toBe(DEFAULT_INSTRUCTIONS.initials)
    expect(cleanInstruction('   ', 'signature')).toBe(DEFAULT_INSTRUCTIONS.signature)
    expect(cleanInstruction(42, 'place')).toBe(DEFAULT_INSTRUCTIONS.place)
  })

  it('removes long dashes and double hyphens (product copy rule)', () => {
    expect(cleanInstruction('Sign here \u2014 as the seller', 'signature')).toBe('Sign here - as the seller')
    expect(cleanInstruction('Sign here -- as the seller', 'signature')).toBe('Sign here - as the seller')
    expect(cleanInstruction('a\u2013b', 'signature')).toBe('a - b')
  })

  it('flattens newlines and caps the length', () => {
    expect(cleanInstruction('one\ntwo\tthree', 'signature')).toBe('one two three')
    expect(cleanInstruction('x'.repeat(500), 'signature').length).toBeLessThanOrEqual(MAX_INSTRUCTION_CHARS)
  })
})

describe('geometry', () => {
  it('clampBox keeps a box on the page and above the minimum size', () => {
    expect(clampBox({ x: 0.9, y: 0.95, width: 0.3, height: 0.2 })).toMatchObject({ x: 0.7, y: 0.8 })
    expect(clampBox({ x: -1, y: -1, width: 0.2, height: 0.2 })).toMatchObject({ x: 0, y: 0 })
    expect(clampBox({ x: 0.5, y: 0.5, width: 0, height: -1 })).toMatchObject({ width: 0.01, height: 0.01 })
  })

  it('newField centres the box on the click and stays inside the page', () => {
    const f = newField('initials', 'Customer', 1, 0.5, 0.5)
    expect(f.x).toBeCloseTo(0.45)
    expect(f.y).toBeCloseTo(0.48)
    const corner = newField('signature', 'Customer', 1, 0.99, 0.99)
    expect(corner.x + corner.width).toBeLessThanOrEqual(1)
    expect(corner.y + corner.height).toBeLessThanOrEqual(1)
  })

  it('newField gives a date box a format and other types none', () => {
    expect(newField('date', 'Customer', 1, 0.5, 0.5, 'year_2').date_format).toBe('year_2')
    expect(newField('signature', 'Customer', 1, 0.5, 0.5).date_format).toBeUndefined()
  })

  it('every new box gets a distinct id and a default instruction', () => {
    const a = newField('initials', 'Customer', 1, 0.5, 0.5)
    const b = newField('initials', 'Customer', 1, 0.5, 0.5)
    expect(a.field_id).not.toBe(b.field_id)
    expect(a.instruction).toBe(DEFAULT_INSTRUCTIONS.initials)
    expect(a.required).toBe(true)
  })
})

describe('repeatOnAllPages (initials on every page)', () => {
  it('copies the box to every other page at the same position', () => {
    const start = [box({ field_id: 'i1', field_type: 'initials', page: 1, x: 0.85, y: 0.94, width: 0.1, height: 0.04 })]
    const out = repeatOnAllPages(start, 'i1', 3)
    expect(out.map(f => f.page).sort()).toEqual([1, 2, 3])
    for (const f of out) expect(f).toMatchObject({ x: 0.85, y: 0.94, width: 0.1, height: 0.04, field_type: 'initials', role: 'Customer' })
    expect(new Set(out.map(f => f.field_id)).size).toBe(3)
  })

  it('does not stack duplicates when pressed twice', () => {
    const start = [box({ field_id: 'i1', field_type: 'initials', page: 1 })]
    const once = repeatOnAllPages(start, 'i1', 3)
    expect(repeatOnAllPages(once, 'i1', 3)).toHaveLength(3)
  })

  it('leaves a page alone if that role already has initials there, and other roles are separate', () => {
    const start = [
      box({ field_id: 'i1', field_type: 'initials', page: 1 }),
      box({ field_id: 'i2', field_type: 'initials', page: 2, x: 0.2 }),
      box({ field_id: 'w', field_type: 'initials', role: 'Witness 1', page: 3 }),
    ]
    const out = repeatOnAllPages(start, 'i1', 3)
    expect(out.filter(f => f.role === 'Customer' && f.page === 2)).toHaveLength(1)   // untouched
    expect(out.filter(f => f.role === 'Customer' && f.page === 3)).toHaveLength(1)   // added
    expect(out.find(f => f.field_id === 'i2')!.x).toBe(0.2)
  })

  it('does nothing for an unknown box', () => {
    const start = [box()]
    expect(repeatOnAllPages(start, 'nope', 3)).toBe(start)
  })
})

describe('roles', () => {
  it('removing a role removes its boxes', () => {
    const out = removeRole(newAoa(), 'Seller')
    expect(out.roles).not.toContain('Seller')
    expect(out.fields.some(f => f.role === 'Seller')).toBe(false)
    expect(out.fields.length).toBe(newAoa().fields.length - 1)
  })

  it('renaming a role keeps its boxes attached', () => {
    const out = renameRole(newAoa(), 'Customer', 'Client')
    expect(out.roles[0]).toBe('Client')
    expect(out.fields.filter(f => f.role === 'Client').length).toBe(newAoa().fields.filter(f => f.role === 'Customer').length)
    expect(out.fields.some(f => f.role === 'Customer')).toBe(false)
  })
})

describe('per-page description', () => {
  it('reads back what the signer must do, page by page, top to bottom', () => {
    const pages = fieldsByPage(newAoa().fields, 3)
    expect(pages.map(p => p.fields.length)).toEqual([1, 7, 1])
    expect(pages[0].fields.map(describeField)).toEqual(['Initials - Customer'])
    const ys = pages[1].fields.map(f => f.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
  })

  it('describes a split date by its format', () => {
    expect(describeField({ field_type: 'date', role: 'Customer', date_format: 'year_2' })).toContain('two-digit year')
    expect(describeField({ field_type: 'date', role: 'Customer', date_format: 'iso' })).toBe('Date - Customer')
  })
})

describe('validateLayout', () => {
  it('accepts the New AOA and reports it ready to send', () => {
    const r = validateLayout(newAoa())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings).toEqual([])
      expect(r.valid).toBe(true)
      expect(r.layout.fields).toHaveLength(9)
    }
  })

  it('warns, without failing, when a role never signs or there are no boxes', () => {
    const noSeller = newAoa()
    noSeller.fields = noSeller.fields.filter(f => f.role !== 'Seller')
    const r = validateLayout(noSeller)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.valid).toBe(false); expect(r.warnings.join(' ')).toContain('Seller has no signature box') }

    const empty = validateLayout({ ...newAoa(), fields: [] })
    expect(empty.ok && empty.warnings.some(w => w.includes('No boxes'))).toBe(true)
  })

  it.each([
    ['blank name', { name: '   ' }],
    ['bad page count', { page_count: 0 }],
    ['non-integer page count', { page_count: 2.5 }],
    ['missing page size', { page_width: undefined }],
    ['no roles', { roles: [] }],
    ['duplicate role (case-insensitive)', { roles: ['Customer', 'customer'] }],
    ['empty role name', { roles: ['Customer', '  '] }],
    ['too many roles', { roles: Array.from({ length: 9 }, (_, i) => `R${i}`) }],
  ])('rejects %s', (_label, patch) => {
    expect(validateLayout({ ...newAoa(), ...patch }).ok).toBe(false)
  })

  it.each([
    ['unknown type', { field_type: 'checkbox' }],
    ['role that does not exist', { role: 'Ghost' }],
    ['page 0', { page: 0 }],
    ['page beyond the form', { page: 4 }],
    ['fractional page', { page: 1.5 }],
    ['negative x', { x: -0.1 }],
    ['box off the right edge', { x: 0.9, width: 0.3 }],
    ['box off the bottom edge', { y: 0.98, height: 0.05 }],
    ['zero-size box', { width: 0 }],
    ['non-numeric position', { x: 'left' }],
    ['no id', { field_id: '' }],
  ])('rejects a box with %s', (_label, patch) => {
    const layout: Record<string, unknown> = { ...newAoa() }
    layout.fields = [{ ...box(), ...patch }]
    layout.roles = ['Customer']
    expect(validateLayout(layout).ok).toBe(false)
  })

  it('rejects two boxes sharing an id', () => {
    const layout = { ...newAoa(), fields: [box({ field_id: 'same' }), box({ field_id: 'same', page: 2 })] }
    expect(validateLayout(layout).ok).toBe(false)
  })

  it('cleans free text instead of trusting it', () => {
    const layout = { ...newAoa(), name: '  New \u2014 AOA  ', fields: [box({ instruction: 'Sign \u2014 here\n now' })], roles: ['Customer'] }
    const r = validateLayout(layout)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.layout.name).toBe('New - AOA')
      expect(r.layout.fields[0].instruction).toBe('Sign - here now')
    }
  })

  it('drops a date format from non-date boxes and defaults a bad one on date boxes', () => {
    const layout = {
      ...newAoa(), roles: ['Customer'],
      fields: [
        box({ field_id: 'a', date_format: 'year_2' as never }),
        box({ field_id: 'b', field_type: 'date', date_format: 'nonsense' as never, page: 2 }),
      ],
    }
    const r = validateLayout(layout)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.layout.fields[0].date_format).toBeUndefined()
      expect(r.layout.fields[1].date_format).toBe('iso')
    }
  })

  it('treats a missing required flag as required and only false as optional', () => {
    const noFlag = { ...box(), required: undefined }
    const optional = { ...box({ field_id: 'o' }), required: false }
    const r = validateLayout({ ...newAoa(), roles: ['Customer'], fields: [noFlag, optional] })
    expect(r.ok && r.layout.fields.map(f => f.required)).toEqual([true, false])
  })

  it('rejects non-object input without throwing', () => {
    for (const bad of [null, undefined, 'x', 5, []]) expect(validateLayout(bad).ok).toBe(false)
  })

  it('caps the number of boxes', () => {
    const many = Array.from({ length: 201 }, (_, i) => box({ field_id: `f${i}` }))
    expect(validateLayout({ ...newAoa(), roles: ['Customer'], fields: many }).ok).toBe(false)
  })
})


describe('boxes that are read from the document', () => {
  it('knows which box types are read from the document, not filled in by a signer', () => {
    expect(isReadType('read_name')).toBe(true)
    expect(isReadType('read_email')).toBe(true)
    for (const t of ['signature', 'initials', 'name', 'date', 'place'] as const) expect(isReadType(t)).toBe(false)
  })

  it('can be placed like any other box and read back by page', () => {
    const f = newField('read_name', 'Customer', 1, 0.45, 0.34)
    expect(f.field_type).toBe('read_name')
    expect(f.instruction).toBe('Read from the document')
    expect(describeField(f)).toBe('Name (read from the document) - Customer')
    expect(fieldsByPage([f], 2)[0].fields).toHaveLength(1)
  })

  it('a form with read boxes is still valid, and they do not count as the role signing', () => {
    const layout = { ...newAoa(), fields: [...newAoa().fields, box({ field_id: 'r1', field_type: 'read_name', role: 'Customer', page: 1, y: 0.33 })] }
    const r = validateLayout(layout)
    expect(r.ok && r.valid).toBe(true)

    const onlyRead = { ...newAoa(), roles: ['Customer'], fields: [box({ field_id: 'r1', field_type: 'read_name', role: 'Customer' })] }
    const bad = validateLayout(onlyRead)
    expect(bad.ok && bad.valid).toBe(false)
    expect(bad.ok && bad.warnings.join(' ')).toContain('Customer has no signature box')
  })
})

describe('people who are always the same (role defaults)', () => {
  const withDefaults = (role_defaults: unknown) => validateLayout({ ...newAoa(), role_defaults })

  it('accepts a default person for a role and lower-cases the email', () => {
    const r = withDefaults([{ role: 'Seller', name: '  Anele   Botha ', email: 'Anele@Bank.Example' }])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.layout.role_defaults).toEqual([{ role: 'Seller', name: 'Anele Botha', email: 'anele@bank.example' }])
  })

  it('a form with no defaults has an empty list', () => {
    const r = validateLayout(newAoa())
    expect(r.ok && r.layout.role_defaults).toEqual([])
  })

  it('drops a row that is empty', () => {
    const r = withDefaults([{ role: 'Seller', name: '  ', email: '' }])
    expect(r.ok && r.layout.role_defaults).toEqual([])
  })

  it.each([
    ['an email that is not an email', [{ role: 'Seller', name: 'A', email: 'not-an-email' }]],
    ['a role that does not exist', [{ role: 'Ghost', name: 'A', email: 'a@b.co' }]],
    ['two defaults for one role', [{ role: 'Seller', name: 'A', email: 'a@b.co' }, { role: 'Seller', name: 'B', email: 'b@b.co' }]],
    ['too many rows', Array.from({ length: 9 }, () => ({ role: 'Seller', name: 'A', email: 'a@b.co' }))],
  ])('rejects %s', (_l, defaults) => {
    expect(withDefaults(defaults).ok).toBe(false)
  })

  it('a name without an email is fine (the agent supplies the email)', () => {
    const r = withDefaults([{ role: 'Seller', name: 'Anele Botha', email: '' }])
    expect(r.ok && r.layout.role_defaults[0]).toEqual({ role: 'Seller', name: 'Anele Botha', email: '' })
  })
})

describe('standard_document', () => {
  const base = {
    name: 'POPI Agreement', page_count: 2, page_width: 612, page_height: 792, roles: ['Signer'],
    fields: [{ field_id: 'a', field_type: 'signature', role: 'Signer', page: 2, x: 0.5, y: 0.8, width: 0.3, height: 0.05, instruction: 'Sign', required: true }],
  }
  it('is off unless the form says so', () => {
    const r = validateLayout(base)
    expect(r.ok && r.layout.standard_document).toBe(false)
  })
  it('is kept when the form says so', () => {
    const r = validateLayout({ ...base, standard_document: true })
    expect(r.ok && r.layout.standard_document).toBe(true)
  })
  it('only a real true counts, never a string', () => {
    const r = validateLayout({ ...base, standard_document: 'true' })
    expect(r.ok && r.layout.standard_document).toBe(false)
  })
})

