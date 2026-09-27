import type { FormField } from './sign-form'
import { DEFAULT_INSTRUCTIONS, isReadType } from './sign-form'

/**
 * What the preview of a saved Sign form shows: who fills each box in, what
 * each person is asked, and the "Page N: ..." lines their signing email lists.
 * Pure logic, no AWS and no browser APIs.
 */

export const ROLE_COLOURS = ['#2563eb', '#c2410c', '#15803d', '#7c3aed', '#b91c1c', '#0e7490', '#a16207', '#be185d']

export const roleColour = (roles: string[], role: string): string =>
  ROLE_COLOURS[Math.max(0, roles.indexOf(role)) % ROLE_COLOURS.length]

// Reading order: page, then top to bottom, then left to right. Box numbers use it.
export function inReadingOrder(fields: FormField[]): FormField[] {
  return [...fields].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
}

const instructionOf = (f: FormField) => (f.instruction && f.instruction.trim()) || DEFAULT_INSTRUCTIONS[f.field_type]

// ---- the signing email ------------------------------------------------------
// Mirrors fn-13's _instructions_for (src/handler.py): one line per page, the
// boxes on a page in the order a person fills it in, a sentence said once.
// Keep the two in step.

const ORDER_ON_PAGE: Record<string, number> = { text: -2, choice: -1, initials: 0, name: 1, place: 2, date: 3, signature: 4 }
const EMAIL_LINE_FOR: Record<string, string> = {
  text:   'Fill in your details on the highlighted lines',
  choice: 'Choose the option that applies on the highlighted words',
}

export function emailLines(fields: FormField[], role: string): string[] {
  const mine = fields
    .filter(f => f.role === role && !isReadType(f.field_type) && f.instruction)
    .sort((a, b) => a.page - b.page || (ORDER_ON_PAGE[a.field_type] ?? 9) - (ORDER_ON_PAGE[b.field_type] ?? 9) || a.y - b.y || a.x - b.x)
  const byPage = new Map<number, string[]>()
  for (const f of mine) {
    const text = (EMAIL_LINE_FOR[f.field_type] ?? f.instruction.trim().replace(/\.+$/, '').trim())
    const said = byPage.get(f.page) ?? []
    if (text && !said.some(x => x.toLowerCase() === text.toLowerCase())) said.push(text)
    byPage.set(f.page, said)
  }
  return Array.from(byPage.entries())
    .sort(([a], [b]) => a - b)
    .filter(([, s]) => s.length > 0)
    .map(([page, s]) => `Page ${page}: ${s.join('. ')}.`)
}

// ---- what each person is asked, in the order the signing page asks it -------

export interface AskedStep {
  title: string
  items: string[]   // the questions, for the details step
}

export function askedSteps(fields: FormField[], role: string): AskedStep[] {
  const mine = inReadingOrder(fields.filter(f => f.role === role && !isReadType(f.field_type)))
  const details: string[] = []
  const seen = new Set<string>()
  for (const f of mine) {
    if (f.field_type === 'text') details.push(instructionOf(f) + (f.required === false ? ' (optional)' : ''))
    if (f.field_type === 'choice' && f.choice_group && !seen.has(f.choice_group)) {
      seen.add(f.choice_group)
      const options = mine.filter(o => o.field_type === 'choice' && o.choice_group === f.choice_group).map(o => o.option ?? '')
      details.push(`${instructionOf(f)} (pick one: ${options.join(' / ')})`)
    }
  }
  const steps: AskedStep[] = []
  if (details.length) steps.push({ title: 'Your details', items: details })
  const has = (t: string) => mine.some(f => f.field_type === t)
  if (has('signature')) steps.push({ title: 'Signature', items: [] })
  if (has('initials')) steps.push({ title: 'Initials', items: [] })
  if (has('date')) steps.push({ title: 'The date', items: [] })
  if (has('place')) steps.push({ title: 'Where you are signing', items: [] })
  if (has('name')) steps.push({ title: 'Printed name (filled in for them)', items: [] })
  return steps
}
