// TheoFlow Channel — recipient-matched fill links. Mirrors src/lib/sign.ts's
// token pattern (a per-recipient tracked link, hashed token, verify-on-load
// and verify-again-on-submit) but keyed off ORG#{orgId} directly, not a
// separate global session -- unlike Sign's URL, the fill URL already carries
// orgId, so there's no need for Sign's extra org-index pointer item.

export type RecipientStatus = 'PENDING' | 'SUBMITTED'

export interface RecipientLink {
  recipient_id:      string
  group:              string
  group_label:        string
  name:               string
  email:              string | null
  token_hash:         string
  token_expires_at:   string
  status:             RecipientStatus
  submission_id:      string | null
  created_at:         string
  updated_at:         string
}

// Longer than Sign's 72h -- this is "here's a form to fill out," not a
// time-boxed signing request.
export const RECIPIENT_LINK_EXPIRY_DAYS = 90

export function tokenExpiryIso(days: number = RECIPIENT_LINK_EXPIRY_DAYS): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}
