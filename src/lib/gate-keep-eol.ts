// The end-of-life period an organisation can agree with TheoFlow for its Gate-Keep files.
// Pure, so the server, the operator screen and the tests all use the same rules.
//
// A file is deleted completely this many years after it was added, but only if it was tagged
// with the period when it was added (the lifecycle rules in infrastructure/terraform/gate-keep
// act on the tag). An organisation with no agreed period is never expired.
//
// Keep EOL_YEARS in step with `end_of_life_years` in the gate-keep terraform stack.

export const EOL_YEARS = [5, 6, 7] as const
export type EolYears = typeof EOL_YEARS[number]

export const isEolYears = (n: unknown): n is EolYears =>
  typeof n === 'number' && (EOL_YEARS as readonly number[]).includes(n)

// The tag the lifecycle rules match on: eol=5y, eol=6y, eol=7y.
export const EOL_TAG_KEY = 'eol'
export const eolTagValue = (y: EolYears) => `${y}y`

// The same arithmetic as the lifecycle rule (ceil(years * 365.25) days), so the date shown to
// members is the date S3 acts on.
export const eolDays = (y: EolYears) => Math.ceil(y * 365.25)
export const eolDate = (addedAtMs: number, y: EolYears) => new Date(addedAtMs + eolDays(y) * 24 * 3600 * 1000)
