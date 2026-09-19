/**
 * TheoFlow Sign — shared types and helpers.
 *
 * Field names mirror shared/models/sign_session.py exactly (snake_case) —
 * fn-13-sign-engine reads/writes the same DynamoDB item shape via
 * SignSession.from_dynamodb_item()/to_dynamodb_item(). Keep in sync.
 */

import { randomBytes, createHash } from 'crypto'

export const TOKEN_EXPIRY_HOURS = 72

export type SignerStatus  = 'PENDING' | 'SIGNED' | 'EXPIRED' | 'DECLINED'
export type SessionStatus = 'DRAFT' | 'PENDING' | 'IN_PROGRESS' | 'SIGNED' | 'EXPIRED' | 'CANCELLED' | 'DECLINED' | 'FAILED'
export type SignatureType = 'DRAWN' | 'TYPED'

export interface Signer {
  signer_id:        string
  name:              string
  email:             string
  role:              string | null
  order:             number
  status:            SignerStatus
  token_hash:        string
  token_expires_at:  string
  token_used:        boolean
  signed_at:         string | null
  ip_address:        string | null
  user_agent:        string | null
  signature_type:    SignatureType | null
  signature_data:    string | null
  place_data:        string | null
  email_sent:        boolean
  expired_at?:       string | null
  signing_date?:     string | null   // YYYY-MM-DD the signer chose for the form's date boxes
  consent_at?:       string | null   // when they agreed to sign electronically
  consent_text_version?: string | null   // which wording they agreed to
  decline_reason?:   string | null
  declined_at?:      string | null
  initials_type?:    SignatureType | null
  initials_data?:    string | null
  field_values?:     Record<string, { value: string | null; at: string }>
}

// Populated by fn-13's document_locator.py (locate_and_notify) -- absent/
// empty until that async stage completes. Mirrors the shape documented in
// shared/models/sign_session.py's module docstring.
export type DetectedFieldType   = 'signature' | 'initials' | 'name' | 'date' | 'place'
export type DetectedFieldSource = 'textract_llm_confirmed' | 'llm_vision_only' | 'fallback_auto_layout' | 'org_configured' | 'org_added'

export interface DetectedField {
  field_id?:     string
  field_type:   DetectedFieldType
  signer_order: number | null
  signer_role?: string | null
  page:         number
  x:            number
  y:            number
  width:        number
  height:       number
  source:       DetectedFieldSource
  confidence:   number
  instruction?: string
  required?:    boolean
  confirmed_by_org?: boolean
  date_format?: 'iso' | 'long' | 'day_month' | 'year_2' | 'year_4'
}

export interface WorkingDocument {
  detected_fields?:  DetectedField[]
  detection_status?: 'DONE'
  detected_at?:      string
  // Set when the session was created from a saved Sign form.
  form?:             { form_id: string; version: number; name: string }
}

export interface SignSession {
  session_id:         string
  source_document:    { s3_key: string; sha256: string; uploaded_at: string }
  working_document:   WorkingDocument
  signers:             Signer[]
  status:              SessionStatus
  created_at:          string
  updated_at:          string
  completed_document?: { s3_key: string; sealed_at: string; sha256?: string } | null
  metadata?:           Record<string, unknown> | null
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

export function tokenExpiryIso(fromDate: Date = new Date()): string {
  return new Date(fromDate.getTime() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()
}
