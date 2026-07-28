// Single source of truth for the marketing contact form's "what do you need
// help with" dropdown -- shared by the client form (src/app/contact/page.tsx)
// and the API route's server-side validation (src/app/api/contact/route.ts)
// so the two can't drift apart.
export const INTEREST_OPTIONS = [
  { value: 'forge',           label: 'Digitizing paper forms (Forge)' },
  { value: 'channel_harvest', label: 'Publishing forms online / collecting responses' },
  { value: 'decode',          label: 'Extracting data from filled documents (Decode)' },
  { value: 'sign',            label: 'E-signatures (Sign)' },
  { value: 'exploring',       label: 'Not sure yet - just exploring' },
  { value: 'other',           label: 'Other' },
] as const

export type InterestValue = typeof INTEREST_OPTIONS[number]['value']

export const INTEREST_VALUES: readonly string[] = INTEREST_OPTIONS.map(o => o.value)

export const CONTACT_MESSAGE_MAX = 255
