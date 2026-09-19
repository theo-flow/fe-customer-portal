/**
 * TheoFlow Sign forms: a saved LAYOUT for one form type.
 *
 * The platform owner configures a customer's form once from the real
 * document: which boxes exist on which page, who fills each one, and what the
 * signer is told to do there. Every later send uploads that person's own PDF
 * (different name, amounts) and applies this layout to it. So this is not a
 * copy of a PDF: it is page count, page size, roles and boxes.
 *
 * Coordinates are normalized 0-1 with the origin at the top-left of the page,
 * the same convention fn-13's detection and sealer use (see
 * shared/models/sign_session.py, detected_fields). Pure logic only, no AWS and
 * no Node APIs, so the editor and the API routes share it.
 */

export const FIELD_TYPES = ['signature', 'initials', 'name', 'date', 'place', 'read_name', 'read_email'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

// Boxes that are READ from the uploaded document instead of being filled in by
// a signer: where the form prints who it is for (their name, their email).
// They never reach a signing session; the send screen uses them to work out
// who the form is destined to.
export const READ_TYPES = ['read_name', 'read_email'] as const
export const isReadType = (t: FieldType): boolean => (READ_TYPES as readonly string[]).includes(t)

export const DATE_FORMATS = ['iso', 'long', 'day_month', 'year_2', 'year_4'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  signature: 'Signature',
  initials:  'Initials',
  name:      'Printed name',
  date:      'Date',
  place:     'Place signed',
  read_name:  'Name (read from the document)',
  read_email: 'Email (read from the document)',
}

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  iso:       '2026-09-19',
  long:      '19 September 2026',
  day_month: '19 September (day and month only)',
  year_2:    '26 (two-digit year, for a printed 20__)',
  year_4:    '2026 (year only)',
}

export const DEFAULT_INSTRUCTIONS: Record<FieldType, string> = {
  signature: 'Sign here',
  initials:  'Initial here',
  name:      'Print your full name',
  date:      'The date is filled in for you',
  place:     'Write where you are signing',
  read_name:  'Read from the document',
  read_email: 'Read from the document',
}

// Default box size (fraction of the page) when the operator places a new box.
export const DEFAULT_SIZES: Record<FieldType, { width: number; height: number }> = {
  signature: { width: 0.30, height: 0.05 },
  initials:  { width: 0.10, height: 0.04 },
  name:      { width: 0.30, height: 0.03 },
  date:      { width: 0.20, height: 0.03 },
  place:     { width: 0.30, height: 0.03 },
  read_name:  { width: 0.40, height: 0.03 },
  read_email: { width: 0.35, height: 0.03 },
}

export const MAX_ROLES = 8
export const MAX_FIELDS = 200
export const MAX_ROLE_CHARS = 40
export const MAX_NAME_CHARS = 80
export const MAX_INSTRUCTION_CHARS = 140
export const MIN_BOX = 0.01
export const MAX_ANCHORS = 12
export const MIN_ANCHOR_CHARS = 8
export const MAX_ANCHOR_CHARS = 80

export interface FormField {
  field_id:     string
  field_type:   FieldType
  role:         string
  page:         number
  x:            number
  y:            number
  width:        number
  height:       number
  instruction:  string
  required:     boolean
  date_format?: DateFormat
}

// A fixed phrase that always appears on a given page of this form (a heading
// or a label next to a signature line, never a name or an amount). A new
// upload is recognised as this form when its pages contain them.
export interface FormAnchor {
  page: number
  text: string
}

// A person who is always the same for a role on this form (for example the
// bank's representative who signs as Seller). Pre-fills the send screen.
export interface RoleDefault {
  role:  string
  name:  string
  email: string
}

export interface FormLayout {
  name:        string
  page_count:  number
  page_width:  number
  page_height: number
  roles:       string[]
  fields:      FormField[]
  anchors:     FormAnchor[]
  role_defaults: RoleDefault[]
}

// ---- ids ------------------------------------------------------------------

export function newFieldId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return 'f-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ---- text -----------------------------------------------------------------

// Instruction text is shown to signers and stamped into emails: one short
// plain line, no control characters, no long dashes or double hyphens (the
// product copy rule), a hard length cap, and a fixed default when empty.
export function cleanInstruction(value: unknown, type: FieldType): string {
  let text = typeof value === 'string' ? value : ''
  text = text.replace(/[\u0000-\u001f\u007f]+/g, ' ')
  text = text.replace(/[\u2014\u2013]/g, ' - ').replace(/-{2,}/g, ' - ')
  text = text.replace(/\s+/g, ' ').trim().slice(0, MAX_INSTRUCTION_CHARS).trim()
  return text || DEFAULT_INSTRUCTIONS[type]
}

export function cleanLabel(value: unknown, max: number): string {
  let text = typeof value === 'string' ? value : ''
  text = text.replace(/[\u0000-\u001f\u007f]+/g, ' ')
  text = text.replace(/[\u2014\u2013]/g, '-').replace(/-{2,}/g, '-')
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

// ---- geometry -------------------------------------------------------------

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// Keeps a box fully inside the page and at least MIN_BOX in each direction.
export function clampBox<T extends { x: number; y: number; width: number; height: number }>(box: T): T {
  const width  = clamp(box.width,  MIN_BOX, 1)
  const height = clamp(box.height, MIN_BOX, 1)
  return {
    ...box,
    width,
    height,
    x: clamp(box.x, 0, 1 - width),
    y: clamp(box.y, 0, 1 - height),
  }
}

// A new box centred on where the operator clicked.
export function newField(
  type: FieldType,
  role: string,
  page: number,
  clickX: number,
  clickY: number,
  dateFormat: DateFormat = 'iso',
): FormField {
  const size = DEFAULT_SIZES[type]
  const box = clampBox({
    x: clickX - size.width / 2,
    y: clickY - size.height / 2,
    width: size.width,
    height: size.height,
  })
  return {
    field_id:    newFieldId(),
    field_type:  type,
    role,
    page,
    ...box,
    instruction: DEFAULT_INSTRUCTIONS[type],
    required:    true,
    ...(type === 'date' ? { date_format: dateFormat } : {}),
  }
}

// "Initials on every page": copies a box to every other page at the same
// position. Pages that already hold a box of the same type and role are left
// alone, so pressing it twice does not stack duplicates.
export function repeatOnAllPages(fields: FormField[], sourceId: string, pageCount: number): FormField[] {
  const source = fields.find(f => f.field_id === sourceId)
  if (!source) return fields
  const additions: FormField[] = []
  for (let page = 1; page <= pageCount; page++) {
    if (page === source.page) continue
    const exists = fields.some(f => f.page === page && f.field_type === source.field_type && f.role === source.role)
    if (exists) continue
    additions.push({ ...source, field_id: newFieldId(), page })
  }
  return additions.length ? [...fields, ...additions] : fields
}

// Removes a role everywhere: its boxes go with it.
export function removeRole(layout: Pick<FormLayout, 'roles' | 'fields'>, role: string) {
  return {
    roles:  layout.roles.filter(r => r !== role),
    fields: layout.fields.filter(f => f.role !== role),
  }
}

// Renames a role and keeps every box attached to it.
export function renameRole(layout: Pick<FormLayout, 'roles' | 'fields'>, from: string, to: string) {
  return {
    roles:  layout.roles.map(r => (r === from ? to : r)),
    fields: layout.fields.map(f => (f.role === from ? { ...f, role: to } : f)),
  }
}

// ---- reading it back the way the operator described it ---------------------

export function describeField(f: Pick<FormField, 'field_type' | 'role' | 'date_format'>): string {
  const base = `${FIELD_TYPE_LABELS[f.field_type]} - ${f.role}`
  return f.field_type === 'date' && f.date_format && f.date_format !== 'iso'
    ? `${base} (${DATE_FORMAT_LABELS[f.date_format]})`
    : base
}

// "Page 1: Initials - Customer" ... the per-page configuration view.
export function fieldsByPage(fields: FormField[], pageCount: number): { page: number; fields: FormField[] }[] {
  return Array.from({ length: pageCount }, (_, i) => {
    const page = i + 1
    return {
      page,
      fields: fields.filter(f => f.page === page).sort((a, b) => a.y - b.y || a.x - b.x),
    }
  })
}

// ---- validation -------------------------------------------------------------

export type LayoutResult =
  | { ok: true;  layout: FormLayout; warnings: string[]; valid: boolean }
  | { ok: false; errors: string[] }

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

// Used by the API before anything is saved, and by the editor before enabling
// Save. Never trusts the client: unknown types, out-of-range pages and boxes
// hanging off the page are rejected, and free text is cleaned.
export function validateLayout(input: unknown): LayoutResult {
  const errors: string[] = []
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

  const name = cleanLabel(raw.name, MAX_NAME_CHARS)
  if (!name) errors.push('Give the form a name.')

  const pageCount = raw.page_count
  if (!Number.isInteger(pageCount) || (pageCount as number) < 1 || (pageCount as number) > 200) {
    errors.push('The page count is missing or invalid.')
  }
  const pageWidth  = raw.page_width
  const pageHeight = raw.page_height
  if (!isNum(pageWidth) || !isNum(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
    errors.push('The page size is missing or invalid.')
  }

  const roles: string[] = []
  if (!Array.isArray(raw.roles) || raw.roles.length === 0) {
    errors.push('Add at least one role, for example Customer.')
  } else {
    if (raw.roles.length > MAX_ROLES) errors.push(`A form can have at most ${MAX_ROLES} roles.`)
    for (const r of raw.roles.slice(0, MAX_ROLES)) {
      const label = cleanLabel(r, MAX_ROLE_CHARS)
      if (!label) { errors.push('A role name cannot be empty.'); continue }
      if (roles.some(x => x.toLowerCase() === label.toLowerCase())) {
        errors.push(`The role "${label}" is used twice.`)
        continue
      }
      roles.push(label)
    }
  }

  const fields: FormField[] = []
  const rawFields = Array.isArray(raw.fields) ? raw.fields : []
  if (rawFields.length > MAX_FIELDS) errors.push(`A form can have at most ${MAX_FIELDS} boxes.`)
  const seenIds = new Set<string>()

  rawFields.slice(0, MAX_FIELDS).forEach((rf, i) => {
    const f = (rf && typeof rf === 'object' ? rf : {}) as Record<string, unknown>
    const where = `Box ${i + 1}`

    const id = typeof f.field_id === 'string' ? f.field_id.trim() : ''
    if (!id || id.length > 64) { errors.push(`${where} has no valid id.`); return }
    if (seenIds.has(id)) { errors.push(`${where} repeats another box's id.`); return }
    seenIds.add(id)

    const type = f.field_type as FieldType
    if (!FIELD_TYPES.includes(type)) { errors.push(`${where} has an unknown type.`); return }

    const role = cleanLabel(f.role, MAX_ROLE_CHARS)
    if (!roles.includes(role)) { errors.push(`${where} belongs to a role that does not exist.`); return }

    const page = f.page
    if (!Number.isInteger(page) || (page as number) < 1 || (Number.isInteger(pageCount) && (page as number) > (pageCount as number))) {
      errors.push(`${where} is on a page that does not exist.`)
      return
    }

    const { x, y, width, height } = f as Record<string, unknown>
    if (!isNum(x) || !isNum(y) || !isNum(width) || !isNum(height)) { errors.push(`${where} has an invalid position.`); return }
    if (width < MIN_BOX || height < MIN_BOX || x < 0 || y < 0 || x + width > 1.0001 || y + height > 1.0001) {
      errors.push(`${where} does not fit on the page.`)
      return
    }

    const field: FormField = {
      field_id:    id,
      field_type:  type,
      role,
      page:        page as number,
      x, y, width, height,
      instruction: cleanInstruction(f.instruction, type),
      required:    f.required === false ? false : true,
    }
    if (type === 'date') {
      field.date_format = DATE_FORMATS.includes(f.date_format as DateFormat) ? (f.date_format as DateFormat) : 'iso'
    }
    fields.push(field)
  })

  const anchors: FormAnchor[] = []
  const rawAnchors = Array.isArray(raw.anchors) ? raw.anchors : []
  if (rawAnchors.length > MAX_ANCHORS) errors.push(`A form can have at most ${MAX_ANCHORS} recognition phrases.`)
  rawAnchors.slice(0, MAX_ANCHORS).forEach((ra, i) => {
    const a = (ra && typeof ra === 'object' ? ra : {}) as Record<string, unknown>
    const where = `Recognition phrase ${i + 1}`
    const text = cleanLabel(a.text, MAX_ANCHOR_CHARS)
    if (text.length < MIN_ANCHOR_CHARS) { errors.push(`${where} is too short to be useful.`); return }
    const page = a.page
    if (!Number.isInteger(page) || (page as number) < 1 || (Number.isInteger(pageCount) && (page as number) > (pageCount as number))) {
      errors.push(`${where} is on a page that does not exist.`)
      return
    }
    const key = `${page}|${text.toLowerCase()}`
    if (anchors.some(x => `${x.page}|${x.text.toLowerCase()}` === key)) return   // silently drop exact repeats
    anchors.push({ page: page as number, text })
  })

  const roleDefaults: RoleDefault[] = []
  const rawDefaults = Array.isArray(raw.role_defaults) ? raw.role_defaults : []
  if (rawDefaults.length > MAX_ROLES) errors.push('Too many default people.')
  rawDefaults.slice(0, MAX_ROLES).forEach((rd, i) => {
    const d = (rd && typeof rd === 'object' ? rd : {}) as Record<string, unknown>
    const role = cleanLabel(d.role, MAX_ROLE_CHARS)
    const name = cleanLabel(d.name, 100)
    const email = cleanLabel(d.email, 120).toLowerCase()
    if (!roles.includes(role)) { errors.push(`Default person ${i + 1} is for a role that does not exist.`); return }
    if (!name && !email) return   // an empty row is just nothing
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errors.push(`The email for the default ${role} is not valid.`); return }
    if (roleDefaults.some(x => x.role === role)) { errors.push(`${role} has two default people.`); return }
    roleDefaults.push({ role, name, email })
  })

  if (errors.length) return { ok: false, errors }

  const warnings: string[] = []
  if (fields.length === 0) warnings.push('No boxes yet. Nothing would be asked of the signer.')
  for (const role of roles) {
    if (!fields.some(f => f.role === role && f.field_type === 'signature')) {
      warnings.push(`${role} has no signature box.`)
    }
  }

  return {
    ok: true,
    layout: {
      name,
      page_count:  pageCount as number,
      page_width:  pageWidth as number,
      page_height: pageHeight as number,
      roles,
      fields,
      anchors,
      role_defaults: roleDefaults,
    },
    warnings,
    // Ready to send only if every role signs somewhere and there is something to do.
    valid: warnings.length === 0,
  }
}
