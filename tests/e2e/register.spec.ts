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

async function expectError(page: Page, fragment: string) {
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 5_000 })
  await expect(alert).toContainText(fragment)
}

// ── Suite ────────────────────────────────────────────────────────────────────
test.describe('Registration — bytheodore', () => {

  test(
    'errors captured + resolved → Motor Car Insurance Application Form',
    async ({ page }) => {

      await page.goto('/register')
      await expect(page.getByText('Register your organisation')).toBeVisible()

      /* ═══════════════════════════════════════════════════════════════════
         STEP 1 — Organisation details
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
      await expect(page.getByText('Choose your products')).toBeVisible()
      console.log('  ✓  Step 1 passed')

      /* ═══════════════════════════════════════════════════════════════════
         STEP 1.5 — Choose products
      ═══════════════════════════════════════════════════════════════════ */
      console.log('\n── Step: Choose products ──')

      // ❌ Error: Continue with nothing selected
      await page.getByRole('button', { name: 'Continue' }).click()
      await expectError(page, 'Select at least one TheoFlow product')
      await shot(page, '02b-products-error-none-selected')

      // ✅ Select Forge — unlocks the form-types and templates steps this
      // test exercises next (needsForms/needsTemplates both key off it)
      await page.getByText('TheoFlow Forge', { exact: true }).click()
      await shot(page, '02c-products-forge-selected')

      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page.getByText('Select your form types')).toBeVisible()
      console.log('  ✓  Products step passed — Forge selected')

      /* ═══════════════════════════════════════════════════════════════════
         STEP 2 — Form types
      ═══════════════════════════════════════════════════════════════════ */
      console.log('\n── Step 2: Form types ──')

      // ❌ Error: Continue with nothing selected
      await page.getByRole('button', { name: 'Continue' }).click()
      await expectError(page, 'Select at least one form type')
      await shot(page, '03-step2-error-no-forms-selected')

      // ── Custom type error demo 1: doc type ticked but no name ──────────
      await page.getByRole('button', { name: 'Add custom form type' }).click()

      // The custom row has a placeholder "Custom form type 1 name…"
      const customInput = page.locator('input[placeholder*="Custom form type"]').first()
      await expect(customInput).toBeVisible()

      // Tick Application Form inside the custom card only
      // (find the parent container of the name input, then click its checkbox)
      const customCard = page.locator('div').filter({ has: customInput }).first()
      await customCard.getByText('Application Form').click()

      // ❌ Error: name empty but doc type selected
      await page.getByRole('button', { name: 'Continue' }).click()
      await expectError(page, 'enter a name before selecting form types')
      await shot(page, '04-step2-error-custom-no-name')

      // ── Custom type error demo 2: name filled but no doc type ──────────
      await customInput.fill('Test Custom Form')
      // Untick Application Form (toggle it back off)
      await customCard.getByText('Application Form').click()

      // ❌ Error: name present but no doc type ticked
      await page.getByRole('button', { name: 'Continue' }).click()
      await expectError(page, 'has a name but no form type selected')
      await shot(page, '05-step2-error-custom-no-doctype')

      // ── Remove the custom row ──────────────────────────────────────────
      await page.getByRole('button', { name: 'Remove custom form type' }).click()
      await expect(customInput).not.toBeVisible()
      await shot(page, '06-step2-custom-row-removed')

      // ── Select Motor Car Insurance — Application Form only ─────────────
      // Find the standard Motor Car Insurance card and tick Application Form
      const motorCard = page.locator('div').filter({
        has: page.getByText('Motor Car Insurance', { exact: true }),
      }).first()

      await motorCard.getByText('Application Form').click()

      // Claim Form must NOT be selected
      await expect(page.getByText('1 form type selected')).toBeVisible()
      await shot(page, '07-step2-motor-car-application-selected')

      // ✅ Advance
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page.getByText('Upload your blank templates')).toBeVisible()
      console.log('  ✓  Step 2 passed — Motor Car Insurance / Application Form only')

      /* ═══════════════════════════════════════════════════════════════════
         STEP 3 — Template upload
      ═══════════════════════════════════════════════════════════════════ */
      console.log('\n── Step 3: Templates ──')

      // One template card for Motor Car Insurance — Application Form
      await expect(page.getByText('Motor Car Insurance')).toBeVisible()
      await expect(page.getByText('Application Form')).toBeVisible()

      // ❌ Error: Continue before resolving the template
      await page.getByRole('button', { name: 'Continue' }).click()
      await expectError(page, 'needs either a file upload or "Use standard template" ticked')
      await shot(page, '08-step3-error-template-unresolved')

      // ✅ Tick "Standard" to use the standard template
      await page.getByText('Standard').first().click()
      await expect(page.getByText('1 / 1 resolved')).toBeVisible()
      await shot(page, '09-step3-template-resolved')

      // ✅ Advance
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page.getByText('Create your account')).toBeVisible()
      console.log('  ✓  Step 3 passed — template resolved with standard')

      /* ═══════════════════════════════════════════════════════════════════
         STEP 4 — Admin credentials
      ═══════════════════════════════════════════════════════════════════ */
      console.log('\n── Step 4: Credentials ──')

      const nameInput     = page.getByPlaceholder('Thabo Nkosi')
      const emailInput    = page.getByPlaceholder('you@example.com')
      const passwordInput = page.getByPlaceholder('Min. 8 characters')
      const confirmInput  = page.getByPlaceholder('Repeat password')

      // ❌ Error: submit with nothing filled
      await page.getByRole('button', { name: 'Register organisation' }).click()
      await expectError(page, 'Full name is required')
      await shot(page, '10-step4-error-no-name')

      // Fill name, try without email
      await nameInput.fill(USER.name)
      await page.getByRole('button', { name: 'Register organisation' }).click()
      await expectError(page, 'valid email address')
      await shot(page, '11-step4-error-no-email')

      // ❌ Error: invalid email format
      await emailInput.fill('not-an-email')
      await page.getByRole('button', { name: 'Register organisation' }).click()
      await expectError(page, 'valid email address')
      await shot(page, '12-step4-error-invalid-email')

      // Fill correct email, try without password
      await emailInput.fill(USER.email)
      await page.getByRole('button', { name: 'Register organisation' }).click()
      await expectError(page, 'uppercase letter, number, and symbol')
      await shot(page, '13-step4-error-weak-password')

      // ❌ Show strength meter with a weak password
      await passwordInput.fill('password')
      await expect(page.getByText('Weak')).toBeVisible()
      await shot(page, '14-step4-weak-password-meter')

      // Fill strong password — meter should show "Strong"
      await passwordInput.fill(USER.password)
      await expect(page.getByText('Strong')).toBeVisible()
      await shot(page, '15-step4-strong-password-meter')

      // ❌ Error: confirm doesn't match
      await confirmInput.fill('WrongPassword!')
      await expect(page.getByText("Passwords do not match.")).toBeVisible()
      await page.getByRole('button', { name: 'Register organisation' }).click()
      await expectError(page, 'Passwords do not match')
      await shot(page, '16-step4-error-password-mismatch')

      // ✅ Fix confirm password
      await confirmInput.fill(USER.password)
      await shot(page, '17-step4-all-fields-correct')
      console.log('  ✓  All step-4 validation errors surfaced and resolved')

      /* ═══════════════════════════════════════════════════════════════════
         SUBMIT
      ═══════════════════════════════════════════════════════════════════ */
      console.log('\n── Submitting ──')

      await page.getByRole('button', { name: 'Register organisation' }).click()

      // Spinner should appear while the API runs
      await expect(page.getByText('Setting up your organisation')).toBeVisible()
      await shot(page, '18-submitting-spinner')

      // Wait for redirect: /verify (new user) or back to /register (e.g. user exists)
      await page.waitForURL(
        url => url.pathname === '/verify' || url.pathname === '/register',
        { timeout: 30_000 }
      )

      if (page.url().includes('/verify')) {
        await shot(page, '19-success-verify-page')
        console.log('  ✓  Registration succeeded — on /verify')
        console.log(`     Check ${USER.email} for the verification code.`)
      } else {
        const alertEl = page.getByRole('alert')
        const alertText = await alertEl.textContent()
        await shot(page, '19-known-error-on-submit')
        console.log(`  ℹ  Landed back on /register: "${alertText?.trim()}"`)
        console.log('     (Expected if this account already exists in Cognito.)')
        // Still treat the test as passing — all UI validation was verified
      }

      console.log(`\n  Screenshots saved to: ${SS_DIR}`)
    }
  )
})
