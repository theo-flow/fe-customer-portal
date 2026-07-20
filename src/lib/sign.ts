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
export type SessionStatus = 'PENDING' | 'IN_PROGRESS' | 'SIGNED' | 'EXPIRED' | 'CANCELLED' | 'FAILED'
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
}

// Populated by fn-13's document_locator.py (locate_and_notify) -- absent/
// empty until that async stage completes. Mirrors the shape documented in
// shared/models/sign_session.py's module docstring.
export type DetectedFieldType   = 'signature' | 'date' | 'place'
export type DetectedFieldSource = 'textract_llm_confirmed' | 'llm_vision_only' | 'fallback_auto_layout'

export interface DetectedField {
  field_type:   DetectedFieldType
  signer_order: number
  page:         number
  x:            number
  y:            number
  width:        number
  height:       number
  source:       DetectedFieldSource
  confidence:   number
}

export interface WorkingDocument {
  detected_fields?: DetectedField[]
}

export interface SignSession {
  session_id:         string
  source_document:    { s3_key: string; sha256: string; uploaded_at: string }
  working_document:   WorkingDocument
  signers:             Signer[]
  status:              SessionStatus
  created_at:          string
  updated_at:          string
  completed_document?: { s3_key: string; sealed_at: string } | null
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
