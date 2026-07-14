// The standard form-group picklist, shared between registration (initial
// selection) and the post-registration "add a group" flow -- one list, so
// they can never drift apart.
export const FORM_GROUPS = [
  { key: 'onboarding',      label: 'Onboarding',      description: 'New client, account, member, or employee registration' },
  { key: 'application',     label: 'Application',     description: 'Applying for a product, policy, loan, or service' },
  { key: 'claim',           label: 'Claim',           description: 'Requesting compensation, reporting a loss, or invoking a right' },
  { key: 'declaration',     label: 'Declaration',     description: 'Disclosing facts — health, financial, risk, or material' },
  { key: 'consent',         label: 'Consent',         description: 'Permission and authorisation — POPIA, payment mandate, treatment' },
  { key: 'assessment',      label: 'Assessment',      description: 'Risk, needs analysis, survey, inspection, or credit evaluation' },
  { key: 'compliance',      label: 'Compliance',      description: 'Regulatory requirements — FICA, KYC, AML, B-BBEE, tax' },
  { key: 'amendment',       label: 'Amendment',       description: 'Changing existing records — address, beneficiary, contact details' },
  { key: 'agreement',       label: 'Agreement',       description: 'Contracts and terms — service agreements, indemnity, SLA' },
  { key: 'incident_report', label: 'Incident Report', description: 'Documenting events — accidents, complaints, near-misses, breaches' },
] as const
