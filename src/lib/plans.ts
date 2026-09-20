/**
 * Plan catalogue — TypeScript mirror of
 * daai-insure-platform/shared/constants/plans.py. Keep both in sync by hand; no
 * cross-language shared module exists in this codebase.
 *
 * Two plans:
 *   Pilot    free for TRIAL_DAYS, every product, one seat, a small document cap.
 *   Starter  the paid plan. Priced per seat (seat-pricing.ts), DOCS_PER_SEAT
 *            documents per seat, every product included.
 *
 * An org moves from Pilot to Starter automatically when its pilot ends
 * (fn-16-billing-rollup), or earlier if its admin chooses. "Bigger" is just more
 * seats: there is no larger plan. Billing is contractual, settled by EFT.
 */

// Pilot length, counted from registration. The reminder goes out on this day;
// the org converts when the pilot ends.
export const TRIAL_DAYS         = 7
export const TRIAL_REMINDER_DAY = 5

export interface PlanTier {
  planId:         string
  name:           string
  basePriceZar:   number   // flat monthly price; 0 for both plans (Starter is per seat)
  docsIncluded:   number   // flat document allowance (Pilot)
  docsPerSeat:    number   // per-seat allowance (Starter); 0 when docsIncluded applies
  overageRateZar: number   // per document beyond the allowance
  fullBundle:     boolean  // every product included
  seatsIncluded:  number   // seats the plan starts with (the admin's)
}

export const PLANS: Record<string, PlanTier> = {
  pilot: {
    planId: 'pilot', name: 'Pilot',
    basePriceZar: 0, docsIncluded: 40, docsPerSeat: 0, overageRateZar: 0, fullBundle: true, seatsIncluded: 1,
  },
  starter: {
    planId: 'starter', name: 'Starter',
    basePriceZar: 0, docsIncluded: 0, docsPerSeat: 50, overageRateZar: 7, fullBundle: true, seatsIncluded: 1,
  },
}

// The plan an org lands on when its pilot ends.
export const PAID_PLAN_ID = 'starter'

// Every product. A pilot and a paid org both get all of them.
export const ALL_PRODUCTS = ['forge', 'channel', 'harvest', 'decode', 'sign', 'print'] as const

export function getPlan(planId: string | undefined): PlanTier | undefined {
  return planId ? PLANS[planId] : undefined
}

/** What a plan gives you, as plain lines for the pricing screens. */
export function planBenefits(plan: PlanTier): string[] {
  if (plan.planId === 'pilot') {
    return [
      'All six products',
      `${TRIAL_DAYS} days, no card or payment needed`,
      `${plan.seatsIncluded} team seat`,
      `${plan.docsIncluded} documents`,
    ]
  }
  return [
    'All six products',
    `${plan.docsPerSeat} documents per seat each month`,
    `Extra documents at R${plan.overageRateZar} each`,
    'Add or remove seats any time',
  ]
}
