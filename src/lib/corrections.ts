import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { ddbDocClient, TABLE } from '@/lib/aws'

// Structured correction feedback -- docs/decode-redesign.md Phase 5. Every
// field a reviewer acts on gets a discrete record, not just an update to
// the submission in place -- this is what makes an accuracy layer possible
// later (by field, by document type, by schema-present-vs-absent), grounded
// in real correction data instead of confidence scores nobody ever
// validated against ground truth.
export type ResolutionType = 'confirmed' | 'corrected' | 'clarify'

export interface Resolution {
  fieldKey:        string
  resolutionType:  ResolutionType
  correctedValue?: string
}

export interface CorrectionRecord {
  orgId:          string
  submissionId:   string
  documentId:     string
  fieldKey:       string
  resolutionType: ResolutionType
  extractedValue: string
  correctedValue: string | null
  schemaPresent:  boolean
  documentType:   string
  reviewedAt:     string
}

// Single-table design, same pattern as this platform's other sparse-item
// types (docs/forge-redesign.md Section 5's status-index precedent) --
// stored alongside the org's other items rather than a new table. SK sorts
// by submission then field then time, so every correction for a submission
// naturally groups together on a Query.
function correctionKey(orgId: string, submissionId: string, fieldKey: string, reviewedAt: string) {
  return {
    PK: `ORG#${orgId}`,
    SK: `CORRECTION#${submissionId}#${fieldKey}#${reviewedAt}`,
  }
}

export async function writeCorrectionRecords(records: CorrectionRecord[]): Promise<void> {
  const db = ddbDocClient()
  await Promise.all(records.map(r =>
    db.send(new PutCommand({
      TableName: TABLE,
      Item: {
        ...correctionKey(r.orgId, r.submissionId, r.fieldKey, r.reviewedAt),
        resolution_type: r.resolutionType,
        org_id:          r.orgId,
        submission_id:   r.submissionId,
        document_id:     r.documentId,
        field_key:       r.fieldKey,
        extracted_value: r.extractedValue,
        corrected_value: r.correctedValue,
        schema_present:  r.schemaPresent,
        document_type:   r.documentType,
        reviewed_at:     r.reviewedAt,
      },
    }))
  ))
}
