import type { FormAnchor, FormField } from './sign-form'
import { MAX_ANCHORS, MAX_ANCHOR_CHARS, MIN_ANCHOR_CHARS } from './sign-form'

/**
 * Text helpers for recognising a Sign form. Pure functions on the shape pdf.js
 * returns from getTextContent(), so they run and are tested without pdf.js.
 * The pdf.js calls themselves live next to the screens that use them.
 */

export interface PdfTextItem {
  str:       string
  transform: number[]   // [a, b, c, d, x, y] in PDF points, origin bottom-left
}

// y is measured from the TOP of the page, 0 to 1, matching how boxes are stored.
export interface TextLine {
  text: string
  y:    number
}

// Lower-case letters and digits only, single spaces.
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Same, with the spaces removed too: pdf.js sometimes splits a word across
// items or joins two, so comparing without spaces is more forgiving.
export function squash(s: string): string {
  return normalizeText(s).replace(/ /g, '')
}

export function pageTextFromItems(items: PdfTextItem[]): string {
  return items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim()
}

// Groups text items into lines by their baseline, top to bottom, each line
// read left to right.
export function linesFromItems(items: PdfTextItem[], pageHeight: number): TextLine[] {
  const rows: { y: number; parts: { x: number; str: string }[] }[] = []
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue
    const x = item.transform[4]
    const y = item.transform[5]
    const row = rows.find(r => Math.abs(r.y - y) <= 2.5)
    if (row) row.parts.push({ x, str: item.str })
    else rows.push({ y, parts: [{ x, str: item.str }] })
  }
  return rows
    .map(r => ({
      text: r.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim(),
      y: 1 - r.y / pageHeight,
    }))
    .sort((a, b) => a.y - b.y)
}

// A line's fixed wording: drop fill-in blanks (____, ....) and anything that
// contains a digit (agreement numbers, amounts, dates, ID numbers), then keep
// the longest run of plain words. What is left is form furniture that is the
// same on every copy, or nothing.
export function fixedWording(line: string): string {
  const blanked = line.replace(/[_.…]{2,}/g, ' ')
  const tokens = blanked.split(/\s+/).filter(Boolean)
  let best: string[] = []
  let run: string[] = []
  const flush = () => {
    if (run.join(' ').length > best.join(' ').length) best = run
    run = []
  }
  for (const t of tokens) {
    if (/\d/.test(t)) flush()
    else run.push(t)
  }
  flush()
  const text = best.join(' ').replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').trim()
  const words = text.split(/\s+/).filter(w => /[A-Za-z]{2,}/.test(w))
  if (words.length < 2 || text.length < MIN_ANCHOR_CHARS) return ''
  return text.slice(0, MAX_ANCHOR_CHARS)
}

// Proposes recognition phrases from a sample: the title on page 1, and the
// wording printed beside each box the operator placed (the labels next to the
// signature lines). The operator reviews and edits these before saving.
export function suggestAnchors(
  pages: { page: number; lines: TextLine[] }[],
  fields: Pick<FormField, 'page' | 'y' | 'height'>[],
  max = 8,
): FormAnchor[] {
  const out: FormAnchor[] = []
  const seen = new Set<string>()
  const add = (page: number, text: string) => {
    const key = squash(text)
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push({ page, text })
  }

  for (const { page, lines } of pages) {
    const usable = lines.map(l => ({ y: l.y, text: fixedWording(l.text) })).filter(l => l.text)
    if (page === 1 && usable[0]) add(1, usable[0].text)
    for (const box of fields.filter(f => f.page === page)) {
      const middle = box.y + box.height / 2
      for (const line of usable) {
        if (Math.abs(line.y - middle) <= 0.05) add(page, line.text)
      }
    }
  }
  return out.slice(0, max)
}

// Adds suggestions to what the operator already has, skipping any phrase that
// is already on the same page (however it is spaced or capitalised) and never
// growing past the limit. The operator's own phrases always stay.
export function mergeAnchors(existing: FormAnchor[], suggested: FormAnchor[]): FormAnchor[] {
  const out = [...existing]
  for (const a of suggested) {
    if (out.length >= MAX_ANCHORS) break
    if (out.some(x => x.page === a.page && squash(x.text) === squash(a.text))) continue
    out.push(a)
  }
  return out
}
