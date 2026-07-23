// Shared shape for a form group's forge pipeline state -- was independently
// redefined in versions/route.ts, history/page.tsx, and templates/page.tsx.
export type ForgeStatus = 'ANALYZING' | 'NEEDS_REVIEW' | 'READY' | 'ERROR'

export interface FormVersion {
  version:         number
  status:          ForgeStatus
  processingStage: string | null
  errorMessage:    string | null
  fieldCount:      number
  reviewNoteCount: number
  createdAt:       string
}

// Mirrors shared/models/form_schema.py's VALID_FIELD_TYPES (daai-insure-platform repo) --
// the review editor's type dropdown needs a single source of truth for this.
export const VALID_FIELD_TYPES = [
  'text', 'textarea', 'date', 'phone', 'email',
  'number', 'currency', 'sa_id', 'select', 'checkbox',
] as const
export type FieldType = typeof VALID_FIELD_TYPES[number]

export interface ReviewNote {
  key:    string
  reason: string
}

// Mirrors shared/models/form_schema.py's FormField dataclass.
export interface FormField {
  key:         string
  label:       string
  field_type:  string
  required:    boolean
  options:     string[] | null
  position?:   { page: number; x: number; y: number; width: number; height: number }
  confidence?: number
  source?:     string
  table_name?: string | null
}
