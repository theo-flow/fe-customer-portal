// Shared shape for a form group's forge pipeline state -- was independently
// redefined in versions/route.ts, history/page.tsx, and templates/page.tsx.
export type ForgeStatus = 'ANALYZING' | 'READY' | 'ERROR'

export interface FormVersion {
  version:         number
  status:          ForgeStatus
  processingStage: string | null
  errorMessage:    string | null
  fieldCount:      number
  createdAt:       string
}
