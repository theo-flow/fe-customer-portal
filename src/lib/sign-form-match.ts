import type { FormAnchor } from './sign-form'
import { squash } from './pdf-text'

/**
 * Decides whether an uploaded PDF fits a saved Sign form, and which of a
 * customer's forms it probably is. Page count and page size are hard
 * requirements (a layout for 3 pages cannot be applied to 4). Recognition
 * phrases tell two forms of the same shape apart. Pure logic, no PDF parsing.
 */

export interface UploadInfo {
  pageCount:  number
  pageWidth:  number
  pageHeight: number
  pageTexts:  string[]   // text of each page, in order
}

export interface FormSummary {
  formId:     string
  name:       string
  pageCount:  number
  pageWidth:  number
  pageHeight: number
  roles:      string[]
  anchors:    FormAnchor[]
}

// 'match'    fits and every recognition phrase was found
// 'unsure'   fits, but the phrases could not confirm it (some missing, or the form has none)
// 'mismatch' cannot be this form
export type MatchStatus = 'match' | 'unsure' | 'mismatch'

export interface MatchResult {
  formId:       string
  status:       MatchStatus
  problems:     string[]
  anchorsFound: number
  anchorsTotal: number
}

const SIZE_TOLERANCE = 0.02
// Below this share of phrases found, it is treated as a different document.
const UNSURE_FLOOR = 0.6

const closeEnough = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * SIZE_TOLERANCE

export function matchForm(upload: UploadInfo, form: FormSummary): MatchResult {
  const problems: string[] = []

  if (upload.pageCount !== form.pageCount) {
    problems.push(
      `This document has ${upload.pageCount} page${upload.pageCount !== 1 ? 's' : ''}, but ${form.name} has ${form.pageCount}.`,
    )
  }
  if (!closeEnough(upload.pageWidth, form.pageWidth) || !closeEnough(upload.pageHeight, form.pageHeight)) {
    problems.push(`The page size is different from ${form.name}.`)
  }
  if (problems.length) {
    return { formId: form.formId, status: 'mismatch', problems, anchorsFound: 0, anchorsTotal: form.anchors.length }
  }

  const total = form.anchors.length
  if (total === 0) {
    return {
      formId: form.formId, status: 'unsure', anchorsFound: 0, anchorsTotal: 0,
      problems: [`${form.name} has no recognition phrases, so it can only be checked by page count and size.`],
    }
  }

  const missing: FormAnchor[] = []
  for (const anchor of form.anchors) {
    const pageText = squash(upload.pageTexts[anchor.page - 1] ?? '')
    if (!pageText.includes(squash(anchor.text))) missing.push(anchor)
  }
  const found = total - missing.length

  if (missing.length === 0) {
    return { formId: form.formId, status: 'match', problems: [], anchorsFound: found, anchorsTotal: total }
  }

  const problemsOut = missing.slice(0, 3).map(a => `Page ${a.page} does not contain "${a.text}".`)
  if (missing.length > 3) problemsOut.push(`And ${missing.length - 3} more phrases were not found.`)
  return {
    formId: form.formId,
    status: found / total >= UNSURE_FLOOR ? 'unsure' : 'mismatch',
    problems: problemsOut,
    anchorsFound: found,
    anchorsTotal: total,
  }
}

// The form to pre-select: only when exactly one of the customer's forms is a
// clear match. Two matches, or none, means the person has to choose.
export function suggestForm(upload: UploadInfo, forms: FormSummary[]): {
  suggested: FormSummary | null
  results: Record<string, MatchResult>
} {
  const results: Record<string, MatchResult> = {}
  for (const form of forms) results[form.formId] = matchForm(upload, form)
  const matches = forms.filter(f => results[f.formId].status === 'match')
  return { suggested: matches.length === 1 ? matches[0] : null, results }
}
