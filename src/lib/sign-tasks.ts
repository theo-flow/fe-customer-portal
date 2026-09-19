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

export type StepId = 'overview' | 'signature' | 'initials' | 'place' | 'review'

export interface Task {
  n:     number
  field: DetectedField
  page:  number
  text:  string
  // date and printed name are filled in for the signer, nothing to do
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
    auto:  field.field_type === 'date' || field.field_type === 'name',
  }))
}

export interface Requirements {
  signature: boolean
  initials:  boolean
  places:    DetectedField[]
}

export function requirements(fields: DetectedField[]): Requirements {
  // No boxes for this signer at all (an older session): ask for a signature.
  if (fields.length === 0) return { signature: true, initials: false, places: [] }
  return {
    signature: fields.some(f => f.field_type === 'signature' && isRequired(f)),
    initials:  fields.some(f => f.field_type === 'initials' && isRequired(f)),
    places:    orderFields(fields.filter(f => f.field_type === 'place' && isRequired(f))),
  }
}

// The pages the signer moves through, only the ones that apply to them.
export function buildSteps(fields: DetectedField[]): StepId[] {
  if (fields.length === 0) return ['signature', 'review']
  const need = requirements(fields)
  const steps: StepId[] = ['overview']
  if (need.signature) steps.push('signature')
  if (need.initials) steps.push('initials')
  if (need.places.length > 0) steps.push('place')
  steps.push('review')
  return steps
}

export const STEP_TITLES: Record<StepId, string> = {
  overview:  'What you need to do',
  signature: 'Your signature',
  initials:  'Your initials',
  place:     'Where you are signing',
  review:    'Check and finish',
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
  return null
}
