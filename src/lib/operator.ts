/**
 * Minimal platform-operator gate -- a deliberate stand-in for Phase 5's real
 * operator-role system, not a full RBAC build. Checks the signed-in user's
 * email against a comma-separated allowlist (OPERATOR_EMAILS env var).
 *
 * Used for views that are platform-wide, not org-scoped -- e.g. the CRM
 * leads list (fe-customer-portal/src/app/api/admin/leads/route.ts).
 * Gating those by custom:org_id the way org-scoped data is gated would let
 * any authenticated org admin see every other prospect's data, a real
 * cross-tenant leak, not just a missing feature.
 */
export function isOperatorEmail(email: string | undefined): boolean {
  if (!email) return false
  const allowlist = (process.env.OPERATOR_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
  return allowlist.includes(email.trim().toLowerCase())
}
