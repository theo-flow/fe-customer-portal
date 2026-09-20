/**
 * Working out who a form is for, from the form itself.
 *
 * The operator marks, once, where on a form the recipient's name (and email, if
 * the form prints one) appear. When an agent uploads a copy of that form, the
 * text inside those regions is read and used to pre-fill the people to send it
 * to. Roles that are always the same person (for example the bank's
 * representative who signs as Seller) come from fixed defaults instead.
 *
 * Nothing read here is trusted blindly: the agent always sees and confirms it
 * before anything is sent, and an email is only accepted if it looks like one.
 * Pure functions on pdf.js text items, so they run without pdf.js.
 */

export interface ReadBox {
  role:   string
  kind:   'name' | 'email'
  page:   number
  x:      number   // 0 to 1, from the top-left of the page
  y:      number
  width:  number
  height: number
}

export interface RoleDefaultPerson {
  role:  string
  name:  string
  email: string
}

// A piece of text on a page, in PDF points, origin at the bottom-left.
export interface PositionedItem {
  str:       string
  transform: number[]
  width:     number
  height:    number
}

export interface ExtractedPerson {
  name?:  string
  email?: string
}

export type Source = 'document' | 'default' | null

export interface SuggestedPerson {
  name:       string
  email:      string
  nameFrom:   Source
  emailFrom:  Source
}

const MAX_NAME = 100

// ---- reading text out of a region -------------------------------------------

export function textInRegion(items: PositionedItem[], box: ReadBox, pageWidth: number, pageHeight: number): string {
  const inside = items.filter(item => {
    if (!item.str || !item.str.trim()) return false
    const centreX = item.transform[4] + (item.width || 0) / 2
    const centreY = item.transform[5] + (item.height || 0) / 2
    const xn = centreX / pageWidth
    const yn = 1 - centreY / pageHeight   // measured down from the top, like the boxes
    return xn >= box.x && xn <= box.x + box.width && yn >= box.y && yn <= box.y + box.height
  })
  // reading order: top line first, then left to right
  inside.sort((a, b) => (b.transform[5] - a.transform[5]) || (a.transform[4] - b.transform[4]))
  return inside.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim()
}

// ---- cleaning what was read --------------------------------------------------

const capitalise = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()

// "THANDI NKOSI" -> "Thandi Nkosi", "DLAMINI-SMITH" -> "Dlamini-Smith", "O'BRIEN" -> "O'Brien"
const titleCase = (s: string) =>
  s.split(/(\s+|-)/).map(part => (/^[A-Za-z']+$/.test(part) ? part.split("'").map(capitalise).join("'") : part)).join('')

// A person's name: no labels, no blanks, no digits, and "THANDI NKOSI" becomes
// "Thandi Nkosi". Anything that does not look like a name comes back empty
// rather than guessed at.
export function cleanName(raw: string): string {
  let text = (raw || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[_.\u2026]{2,}/g, ' ')
    .replace(/^\s*(full\s+)?(names?|surname|customer|client)\s*[:\-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  // A name never contains a digit. Checked BEFORE trimming the ends, otherwise
  // "ID Number: 8801015800086" would lose its number and pass as a name.
  if (/\d/.test(text)) return ''
  text = text.replace(/^[^A-Za-z]+|[^A-Za-z.'\-]+$/g, '')
  if (!text || text.length < 2) return ''
  if (text === text.toUpperCase()) text = titleCase(text)
  return text.slice(0, MAX_NAME)
}

// The first thing in the text that is shaped like an email address.
export function cleanEmail(raw: string): string {
  const match = (raw || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/)
  return match ? match[0].toLowerCase() : ''
}

// ---- putting it together ------------------------------------------------------

export function readRecipients(
  pageItems: PositionedItem[][],
  pageWidth: number,
  pageHeight: number,
  reads: ReadBox[],
): Record<string, ExtractedPerson> {
  const out: Record<string, ExtractedPerson> = {}
  for (const box of reads) {
    const items = pageItems[box.page - 1]
    if (!items) continue
    const text = textInRegion(items, box, pageWidth, pageHeight)
    const value = box.kind === 'name' ? cleanName(text) : cleanEmail(text)
    if (!value) continue
    const person = (out[box.role] ??= {})
    if (box.kind === 'name' && !person.name) person.name = value
    if (box.kind === 'email' && !person.email) person.email = value
  }
  return out
}

// For every role: what was read from this document wins, then the form's fixed
// default person, otherwise blank for the agent to fill in.
export function suggestPeople(
  roles: string[],
  extracted: Record<string, ExtractedPerson>,
  defaults: RoleDefaultPerson[],
): Record<string, SuggestedPerson> {
  const out: Record<string, SuggestedPerson> = {}
  for (const role of roles) {
    const read = extracted[role] ?? {}
    const def = defaults.find(d => d.role === role)
    out[role] = {
      name:      read.name  ?? def?.name  ?? '',
      email:     read.email ?? def?.email ?? '',
      nameFrom:  read.name  ? 'document' : def?.name  ? 'default' : null,
      emailFrom: read.email ? 'document' : def?.email ? 'default' : null,
    }
  }
  return out
}
