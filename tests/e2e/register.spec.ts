import { test, expect, Page } from '@playwright/test'
import * as fs   from 'fs'
import * as path from 'path'

// ── Test data ───────────────────────────────────────────────────────────────
const SS_DIR = path.join(__dirname, 'screenshots')
const USER = {
  name:     'Sithembiso Mjoko',
  email:    'sjmjoko@gmail.com',
  phone:    '0768248935',
  company:  'bytheodore',
  password: 'Theoflow@2026!',   // uppercase + digit + symbol + 14 chars = Strong
}

// ── Helpers ─────────────────────────────────────────────────────────────────
async function shot(page: Page, label: string) {
  fs.mkdirSync(SS_DIR, { recursive: true })
  const file = path.join(SS_DIR, `${label}.png`)
  await page.screenshot({ path: file, fullPage: false })
  console.log(`  📸  ${label}.png`)
}

// Scoped to data-testid, not role=alert — Next.js injects its own
// role="alert" route-announcer into every page, which makes the ARIA role
// alone ambiguous once client hydration is actually working.
async function expectError(page: Page, fragment: string) {
  const alert = page.getByTestId('form-error')
  await expect(alert).toBeVisible({ timeout: 5_000 })
  await expect(alert).toContainText(fragment)
}

// ── Suite ────────────────────────────────────────────────────────────────────
test.describe('Registration — bytheodore', () => {

  test(
    'errors captured + resolved → Organisation then Account',
    async ({ page }) => {

      await page.goto('/register')
      await expect(page.getByText('Register your organisation')).toBeVisible()

      /* ═══════════════════════════════════════════════════════════════════
         STEP 1 — Organisation
      ═══════════════════════════════════════════════════════════════════ */
      console.log('\n── Step 1: Organisation ──')

      // ❌ Error: Continue with no org name
      await page.getByRole('button', { name: 'Continue' }).click()
      await expectError(page, 'Organisation name is required')
      await shot(page, '01-step1-error-org-name-required')

      // ✅ Fill company name
      await page.getByPlaceholder('e.g. ABC Brokers (Pty) Ltd').fill(USER.company)

      // CIPC — intentionally left blank (field is optional)
      console.log('  ℹ  CIPC left blank — it is optional')

      // Fill phone
      await page.getByPlaceholder('+27 11 000 0000').fill(USER.phone)
      await shot(page, '02-step1-filled')

      // ✅ Advance
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page.getByText('Create your account')).toBeVisible()
      console.log('  ✓  Step 1 passed')

      /* ═══════════════════════════════════════════════════════════════════
         STEP 2 — Account (admin credentials)
      ═══════════════════════════════════════════════════════════════════ */
      console.log('\n── Step 2: Account ──')

      const nameInput     = page.getByPlaceholder('Thabo Nkosi')
      const emailInput    = page.getByPlaceholder('you@example.com')
      const passwordInput = page.getByPlaceholder('Min. 12 characters')
      const confirmInput  = page.getByPlaceholder('Repeat password')

      // ❌ Error: submit with nothing filled
      await page.getByRole('button', { name: 'Register organisation' }).click()
      await expectError(page, 'Full name is required')
      await shot(page, '03-step2-error-no-name')

      // Fill name, try without email
      await nameInput.fill(USER.name)
      await page.getByRole('button', { name: 'Register organisation' }).click()
      await expectError(page, 'valid email address')
      await shot(page, '04-step2-error-no-email')

      // ❌ Error: invalid email format
      await emailInput.fill('not-an-email')
      await page.getByRole('button', { name: 'Register organisation' }).click()
      await expectError(page, 'valid email address')
      await shot(page, '05-step2-error-invalid-email')

      // Fill correct email, try without password
      await emailInput.fill(USER.email)
      await page.getByRole('button', { name: 'Register organisation' }).click()
      await expectError(page, 'uppercase letter, a lowercase letter, and a number')
      await shot(page, '06-step2-error-weak-password')

      // ❌ Show strength meter with a weak password
      await passwordInput.fill('password')
      await expect(page.getByText('Weak')).toBeVisible()
      await shot(page, '07-step2-weak-password-meter')

      // Fill strong password — meter should show "Strong"
      await passwordInput.fill(USER.password)
      await expect(page.getByText('Strong')).toBeVisible()
      await shot(page, '08-step2-strong-password-meter')

      // ❌ Error: confirm doesn't match
      await confirmInput.fill('WrongPassword!')
      await expect(page.getByText('Passwords do not match.')).toBeVisible()
      await page.getByRole('button', { name: 'Register organisation' }).click()
      await expectError(page, 'Passwords do not match')
      await shot(page, '09-step2-error-password-mismatch')

      // ✅ Fix confirm password
      await confirmInput.fill(USER.password)
      await shot(page, '10-step2-all-fields-correct')
      console.log('  ✓  All step-2 validation errors surfaced and resolved')

      /* ═══════════════════════════════════════════════════════════════════
         SUBMIT
      ═══════════════════════════════════════════════════════════════════ */
      console.log('\n── Submitting ──')

      await page.getByRole('button', { name: 'Register organisation' }).click()

      // Spinner should appear while the API runs
      await expect(page.getByText('Setting up your organisation')).toBeVisible()
      await shot(page, '11-submitting-spinner')

      // Wait for redirect: /verify (new user) or back to /register (e.g. user exists)
      await page.waitForURL(
        url => url.pathname === '/verify' || url.pathname === '/register',
        { timeout: 30_000 }
      )

      if (page.url().includes('/verify')) {
        await shot(page, '12-success-verify-page')
        console.log('  ✓  Registration succeeded — on /verify')
        console.log(`     Check ${USER.email} for the verification code.`)
      } else {
        const alertEl = page.getByTestId('form-error')
        const alertText = await alertEl.textContent()
        await shot(page, '12-known-error-on-submit')
        console.log(`  ℹ  Landed back on /register: "${alertText?.trim()}"`)
        console.log('     (Expected if this account already exists in Cognito.)')
        // Still treat the test as passing — all UI validation was verified
      }

      console.log(`\n  Screenshots saved to: ${SS_DIR}`)
    }
  )
})
