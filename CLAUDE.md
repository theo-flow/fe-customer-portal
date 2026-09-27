# CLAUDE.md — fe-customer-portal

Next.js customer portal + marketing site for TheoFlow (theoflow.bytheodore.co.za). Deployed as
an OpenNext SSR Lambda (`theoflow-portal-production-server`) behind CloudFront, in the sibling
`daai-insure-platform` repo's `infrastructure/terraform/frontend/`. There is no CI for this repo
— every deploy is manual: `npm run build:deploy`, zip `.open-next/server-function`,
`aws lambda update-function-code`, sync `.open-next/assets` to S3, invalidate CloudFront.

## Sign forms (locked)

- **Follow `docs/sign-form-design-method.md` in `daai-insure-platform` exactly.** Every printed
  blank is a box on its line filled in by the person it belongs to; printed options are choices,
  circled on the sealed copy; each person only has their own part. Every new or changed form is
  shown to the owner as a local preview (fn-13 `scripts/preview_sign_form.py`) and approved before
  anything is merged, deployed or saved. `src/lib/__tests__/sign-form-lock.test.ts` fails if an
  approved layout or the email wording drifts; `sign-form-preview.ts` `emailLines` must stay in
  step with fn-13 `_instructions_for` (shared `fixtures/email_contract.json`). Only change the
  fingerprints with an owner-approved change, in both repos together.

## Copy / typography rules

- **No em dashes (`—`) or double dashes (`--`) anywhere in user-visible text — use a single
  hyphen (`-`) instead.** Corrected 2026-07-28: em dash was tried first and read as a "double
  dash" to the eye, which is exactly what this rule exists to avoid. This applies to all
  marketing pages (`src/app/page.tsx`, `about`, `features`, `product`, `contact`) and any other
  rendered copy — headings, body text, button labels, `metadata` title/description strings.
  Does not apply to code comments, CSS custom properties (`var(--radius)`), or non-visible
  source.
- Do not mention "AI" or name the underlying AI service/vendor (Bedrock, etc.) in user-facing
  marketing copy. Describe the outcome (e.g. "every field is read and scored"), not the
  mechanism — this is a deliberate positioning choice, not an oversight.
