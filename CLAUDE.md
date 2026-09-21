# CLAUDE.md — fe-customer-portal

Next.js customer portal + marketing site for TheoFlow (theoflow.bytheodore.co.za). Deployed as
an OpenNext SSR Lambda (`theoflow-portal-production-server`) behind CloudFront, in the sibling
`daai-insure-platform` repo's `infrastructure/terraform/frontend/`. There is no CI for this repo
— every deploy is manual: `npm run build:deploy`, zip `.open-next/server-function`,
`aws lambda update-function-code`, sync `.open-next/assets` to S3, invalidate CloudFront.

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

## Form design (locked, 2026-09-21)

Follow `docs/forge-design-method.md` in the `daai-insure-platform` repo exactly.
- A form whose fields carry `section` / `section_group` is drawn as printed section cards, two columns wide and stacked narrow (`SectionedFormCanvas`, `src/lib/form-sections.ts`). Do not replace this with a flat list or add layout the customer's form does not have.
- **Numbers are entered as numbers.** Amounts are a plain text input with a decimal keypad, never `type="number"` (no spinner arrows, no scroll-wheel changes). Only digits and one decimal point can be typed (`src/lib/numeric-input.ts`); number fields take digits only.
- This repo has no CI. Merging does not ship: deploy with `scripts/deploy-portal.ps1` (platform repo) and check the real page afterwards.
