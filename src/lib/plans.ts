/**
 * Pricing plan catalog — TypeScript mirror of
 * daai-insure-platform/shared/constants/plans.py. Keep both in sync by hand;
 * no cross-language shared module exists in this codebase (table/queue names
 * are duplicated the same way across the Python backend and this portal).
 *
 * Static, code-defined — not a DynamoDB table. Billing is contractual
 * (negotiated per customer, settled by EFT), not self-service; these four
 * tiers are starting points for a contract, not a public self-serve menu.
 */

export interface PlanTier {
  planId:          string
  name:            string
  basePriceZar:    number
  docsIncluded:    number
  overageRateZar:  number
  fullBundle:       boolean
}

export const PLANS: Record<string, PlanTier> = {
  pilot: {
    planId: 'pilot', name: 'Pilot',
    basePriceZar: 0, docsIncluded: 40, overageRateZar: 0, fullBundle: false,
  },
  starter: {
    planId: 'starter', name: 'Starter',
    basePriceZar: 650, docsIncluded: 100, overageRateZar: 7, fullBundle: true,
  },
  growth: {
    planId: 'growth', name: 'Growth',
    basePriceZar: 1600, docsIncluded: 400, overageRateZar: 6, fullBundle: true,
  },
  multi_site: {
    planId: 'multi_site', name: 'Multi-site',
    basePriceZar: 3500, docsIncluded: 1200, overageRateZar: 5, fullBundle: true,
  },
}

export function getPlan(planId: string): PlanTier | undefined {
  return PLANS[planId]
}
