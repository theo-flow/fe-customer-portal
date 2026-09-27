// Locks the approved Sign forms (daai-insure-platform docs/sign-form-design-method.md).
// The fixtures are the same files as fn-13-sign-engine tests/fixtures/sign_forms/,
// with the same fingerprints as its tests/unit/test_sign_form_lock.py. Change a
// fingerprint only with an owner-approved change, in both repos together.
import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validateLayout, type FormField } from '../sign-form'
import { emailLines } from '../sign-form-preview'

const FIXTURES = join(__dirname, 'fixtures')
const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

// Same canonical form as Python's json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False).
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}
const fingerprint = (v: unknown) => createHash('sha256').update(canonical(v), 'utf8').digest('hex')

const LOCKED: Record<string, string> = {
  'consent-service-single.layout.json': 'a130bee8be2a9a248d0441338c875b5aee33142fd3f5614c56d3ed26d98420b6',
  'consent-service-joint.layout.json':  '3f6c04edb600dc4dce2a3bd896a94e971128c2a59b447f9d316dc97dc0e68b2b',
  'email_contract.json':                '0b24a382e3d087fdb6a13a0591ad0e355d29da24539c1d9922ceaf876ffb144c',
}

describe('the approved Sign forms are locked', () => {
  for (const [name, locked] of Object.entries(LOCKED)) {
    it(`${name} has not changed (owner approval needed to change it)`, () => {
      expect(fingerprint(load(name))).toBe(locked)
    })
  }

  for (const name of ['consent-service-single.layout.json', 'consent-service-joint.layout.json']) {
    it(`${name} is valid, sent with no upload, and every person fills in their own details`, () => {
      const r = validateLayout(load(name))
      expect(r.ok && r.valid).toBe(true)
      if (!r.ok) return
      expect(r.layout.standard_document).toBe(true)
      for (const role of r.layout.roles) {
        expect(r.layout.fields.some(f => f.role === role && f.field_type === 'text')).toBe(true)
      }
    })
  }
})

describe('the Preview shows the same email instructions fn-13 sends', () => {
  const { cases } = load('email_contract.json') as {
    cases: { name: string; role: string; fields: Partial<FormField>[]; expected: string[] }[]
  }
  for (const c of cases) {
    it(c.name, () => {
      expect(emailLines(c.fields as FormField[], c.role)).toEqual(c.expected)
    })
  }
})
