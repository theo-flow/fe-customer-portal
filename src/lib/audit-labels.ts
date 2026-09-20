// The parts of the audit trail the browser needs: the action names, the shape of an
// entry, and the plain-English labels. Deliberately no imports at all. The recorder
// itself (audit.ts) uses the AWS client and node:crypto, which cannot be bundled into
// a page, so anything a page needs must live here.

// What an org's admin can see in Activity: who did what, and when. Only the things a
// person does deliberately are recorded (sending a form, inviting someone, changing
// the plan). Nothing here holds a form's answers, a token, or a password.
export type AuditAction =
  | 'team.invite'
  | 'team.joined'
  | 'team.remove'
  | 'team.seats'
  | 'billing.subscribe'
  | 'billing.cancel_pilot'
  | 'form.publish'
  | 'form.link_created'
  | 'template.upload'
  | 'submission.view'
  | 'submission.export'
  | 'sign.session_started'

export interface AuditEntry {
  auditId:    string
  at:         string
  actorSub:   string
  actorEmail: string
  actorRole:  'admin' | 'agent'
  action:     AuditAction
  target:     string | null
}

// Lives next to the action list so a new action can't be added without a label (the
// test checks every action has one).
export const AUDIT_LABELS: Record<AuditAction, string> = {
  'team.invite':          'Invited someone to the team',
  'team.joined':          'Joined the team',
  'team.remove':          'Removed someone from the team',
  'team.seats':           'Changed the number of seats',
  'billing.subscribe':    'Started the paid plan',
  'billing.cancel_pilot': 'Cancelled the pilot',
  'form.publish':         'Published a form',
  'form.link_created':    'Sent a form to someone',
  'template.upload':      'Uploaded a template',
  'submission.view':      'Opened a submission',
  'submission.export':    'Exported a submission',
  'sign.session_started': 'Sent a document for signing',
}
