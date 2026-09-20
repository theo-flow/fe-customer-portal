import type { DetectedField } from './sign'
import { DEFAULT_INSTRUCTIONS } from './sign-form'

/**
 * What one signer has to do on a document, worked out from the boxes that
 * belong to them. Shared by the signing page (to build the checklist and the
 * steps) and by the submit route (to check, on the server, that everything
 * required was actually provided). No AWS, no browser APIs.
 *
 * Sessions created before Sign forms existed have no boxes for a signer (or
 * only old-style ones without instructions). They keep working: with no boxes
 * the signer is asked for a signature, exactly as before.
 */

export const MAX_MARK_CHARS  = 400_000   // a drawn signature or initials, as a data URL
export const MAX_TYPED_CHARS = 80
export const MAX_PLACE_CHARS = 100

export interface Task {
  n:     number
  field: DetectedField
  page:  number
  text:  string
  // the printed name is filled in for the signer, nothing to do
  auto:  boolean
}

// ---- reading the boxes ------------------------------------------------------

export function orderFields(fields: DetectedField[]): DetectedField[] {
  return [...fields].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
}

export function instructionOf(f: DetectedField): string {
  return (f.instruction && f.instruction.trim()) || DEFAULT_INSTRUCTIONS[f.field_type]
}

// Boxes are required unless the operator said otherwise.
const isRequired = (f: DetectedField) => f.required !== false

export function buildTasks(fields: DetectedField[]): Task[] {
  return orderFields(fields).map((field, i) => ({
    n:     i + 1,
    field,
    page:  field.page,
    text:  instructionOf(field),
    auto:  field.field_type === 'name',
  }))
}

export interface Requirements {
  signature: boolean
  initials:  boolean
  dates:     DetectedField[]
  places:    DetectedField[]
}

export function requirements(fields: DetectedField[]): Requirements {
  // No boxes for this signer at all (an older session): ask for a signature.
  if (fields.length === 0) return { signature: true, initials: false, dates: [], places: [] }
  return {
    signature: fields.some(f => f.field_type === 'signature' && isRequired(f)),
    initials:  fields.some(f => f.field_type === 'initials' && isRequired(f)),
    dates:     orderFields(fields.filter(f => f.field_type === 'date' && isRequired(f))),
    places:    orderFields(fields.filter(f => f.field_type === 'place' && isRequired(f))),
  }
}

// ---- groups: the signer is walked through the document one KIND of thing at a
// time. Doing it once (their signature, their initials, the date, the place)
// applies it to every box of that kind, so a form with initials on seven pages
// is still one task.

export type GroupId = 'signature' | 'initials' | 'date' | 'place'

// Which kinds of task this person has, in the order they are asked.
export function buildGroups(fields: DetectedField[]): GroupId[] {
  if (fields.length === 0) return ['signature']   // an older session: just a signature
  const need = requirements(fields)
  const groups: GroupId[] = []
  if (need.signature) groups.push('signature')
  if (need.initials) groups.push('initials')
  if (need.dates.length > 0) groups.push('date')
  if (need.places.length > 0) groups.push('place')
  return groups
}

// The boxes a group applies to, in reading order.
export function boxesOf(fields: DetectedField[], group: GroupId): DetectedField[] {
  return orderFields(fields.filter(f => f.field_type === group))
}

// "page 2", "pages 1 and 2", "pages 1, 2 and 3"
export function pagesPhrase(fields: DetectedField[]): string {
  const pages = Array.from(new Set(fields.map(f => f.page))).sort((a, b) => a - b)
  if (pages.length === 0) return 'the document'
  if (pages.length === 1) return `page ${pages[0]}`
  return `pages ${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}`
}

export const GROUP_TITLES: Record<GroupId, string> = {
  signature: 'Your signature',
  initials:  'Your initials',
  date:      'The date',
  place:     'Where you are signing',
}

// One line per kind of task, for the checklist the signer sees first.
export function summariseGroups(fields: DetectedField[]): { group: GroupId; text: string }[] {
  return buildGroups(fields).map(group => {
    const boxes = boxesOf(fields, group)
    const where = pagesPhrase(boxes)
    const text =
      group === 'signature' ? (boxes.length ? `Sign on ${where}` : 'Sign the document')
      : group === 'initials' ? `Initial on ${where}`
      : group === 'date'     ? `Choose the date, it is written on ${where}`
      :                        `Write where you are signing, on ${where}`
    return { group, text }
  })
}

// ---- dates ---------------------------------------------------------------
// The signer chooses the date the form asks for, but not any date: it starts
// as today, can go back a limited number of days, and never forward. The real
// moment of signing is still recorded separately (signed_at), so the audit
// trail shows both. South Africa has no daylight saving, so a fixed +02:00
// offset is exact.

export const DATE_WINDOW_DAYS = 30
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000

export function todaySAST(now: Date = new Date()): string {
  return new Date(now.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10)
}

export function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export function dateBounds(now: Date = new Date()): { min: string; max: string } {
  const max = todaySAST(now)
  const [y, m, d] = max.split('-').map(Number)
  const min = new Date(Date.UTC(y, m - 1, d - DATE_WINDOW_DAYS)).toISOString().slice(0, 10)
  return { min, max }
}

export function dateProblem(iso: unknown, now: Date = new Date()): string | null {
  if (typeof iso !== 'string' || !isRealDate(iso)) return 'Please choose a valid date.'
  const { min, max } = dateBounds(now)
  if (iso > max) return 'The date cannot be in the future.'
  if (iso < min) return `The date cannot be more than ${DATE_WINDOW_DAYS} days ago.`
  return null
}

// "Thandi Nkosi" -> "TN". Up to three letters, so a long name stays short.
export function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(w => /[A-Za-z]/.test(w))
    .slice(0, 3)
    .map(w => (w.match(/[A-Za-z]/) as RegExpMatchArray)[0].toUpperCase())
    .join('')
}

// ---- what the signer submits, and the check both sides run ------------------

export type MarkType = 'DRAWN' | 'TYPED'

export interface Submission {
  signatureType?: MarkType
  signatureData?: string
  initialsType?:  MarkType
  initialsData?:  string
  // typed answers for place boxes, keyed by the box's field_id
  placeValues?:   Record<string, string>
  // older single "place" answer, for boxes that have no field_id
  placeData?:     string
  // the date the signer chose (YYYY-MM-DD), written into every date box in that box's format
  signingDate?:   string
}

export function cleanPlace(v: unknown): string {
  return (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PLACE_CHARS)
}

export function placeValueFor(f: DetectedField, s: Submission): string {
  return cleanPlace(f.field_id ? s.placeValues?.[f.field_id] : s.placeData)
}

function markProblem(label: string, type: unknown, data: unknown): string | null {
  if (type !== 'DRAWN' && type !== 'TYPED') return `Please add your ${label}.`
  if (typeof data !== 'string' || !data.trim()) return `Please add your ${label}.`
  if (type === 'TYPED') {
    return data.trim().length > MAX_TYPED_CHARS ? `Your ${label} is too long.` : null
  }
  if (!data.startsWith('data:image/png;base64,') || data.length > MAX_MARK_CHARS) {
    return `Your ${label} could not be read. Please draw it again.`
  }
  return null
}

// Returns a message for the first thing that is missing or wrong, or null when
// the submission is complete for these boxes.
export function validateSubmission(fields: DetectedField[], s: Submission): string | null {
  const need = requirements(fields)
  if (need.signature) {
    const p = markProblem('signature', s.signatureType, s.signatureData)
    if (p) return p
  } else if (s.signatureData !== undefined) {
    // optional, but if it was sent it must be well formed
    const p = markProblem('signature', s.signatureType, s.signatureData)
    if (p) return p
  }
  if (need.initials) {
    const p = markProblem('initials', s.initialsType, s.initialsData)
    if (p) return p
  }
  for (const f of need.places) {
    if (!placeValueFor(f, s)) return `Please say where you are signing (page ${f.page}).`
  }
  // Optional (an older signing page never sent one and the day of signing is
  // used), but a date that was sent must be a real date inside the window.
  if (s.signingDate !== undefined) {
    const p = dateProblem(s.signingDate)
    if (p) return p
  }
  return null
}

// ---- showing a date the way the form writes it -------------------------------
// Mirrors fn-13's format_signing_date, so what the signer sees in the box while
// they choose is what gets stamped on the sealed document.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export type DateFormatName = 'iso' | 'long' | 'day_month' | 'year_2' | 'year_4'

export function formatChosenDate(iso: string, format?: string): string {
  if (!isRealDate(iso)) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (format === 'day_month') return `${d} ${MONTHS[m - 1]}`
  if (format === 'year_2')    return String(y % 100).padStart(2, '0')
  if (format === 'year_4')    return String(y)
  if (format === 'long')      return `${d} ${MONTHS[m - 1]} ${y}`
  return iso
}
