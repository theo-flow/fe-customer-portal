import { test, expect, Page } from '@playwright/test'
import * as fs   from 'fs'
import * as path from 'path'

// Two existing org accounts, temp passwords set via admin-set-user-password
// for this run only -- see conversation notes, not meant to be durable creds.
const USER_A = { email: 'sjmjoko+thabo@gmail.com',  password: 'GkTest2026Playwright!', org: 'org-6424cb01' }
const USER_B = { email: 'sjmjoko+mizana@gmail.com', password: 'GkTest2026Playwright!', org: 'org-3def76d5' }

const SS_DIR = path.join(__dirname, 'screenshots')

async function shot(page: Page, label: string) {
  fs.mkdirSync(SS_DIR, { recursive: true })
  const file = path.join(SS_DIR, `${label}.png`)
  await page.screenshot({ path: file, fullPage: false })
  console.log(`  📸  ${label}.png`)
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => url.pathname === '/dashboard', { timeout: 30_000 })
}

test.describe('Gate-Keep — per-user isolation', () => {

  test('User A sees only their own file, User B sees only theirs, and cannot fetch A\'s key', async ({ browser }) => {
    // ── User A: log in, confirm their migrated file is visible, upload a new one ──
    const ctxA = await browser.newContext()
    const pageA = await ctxA.newPage()
    await login(pageA, USER_A.email, USER_A.password)
    console.log('  ✓  User A logged in')

    await pageA.goto('/gate-keep')
    await expect(pageA.getByText('Your stored files')).toBeVisible({ timeout: 20_000 })
    await shot(pageA, '01-userA-gate-keep-page')

    // The object migrated earlier this session should show up here.
    await expect(pageA.getByText(/Screenshot_27-8-2026_171916_/)).toBeVisible({ timeout: 15_000 })
    await shot(pageA, '02-userA-sees-migrated-file')
    console.log('  ✓  User A sees their pre-existing migrated file')

    // Upload a fresh file as User A.
    const testFilePath = path.join(SS_DIR, 'userA-test-upload.txt')
    fs.mkdirSync(SS_DIR, { recursive: true })
    fs.writeFileSync(testFilePath, 'Gate-Keep isolation test — User A file.\n')

    const fileInput = pageA.locator('input[type="file"]')
    await fileInput.setInputFiles(testFilePath)
    await pageA.getByRole('button', { name: /Upload 1 file/ }).click()
    await expect(pageA.getByText('1 file uploaded successfully.')).toBeVisible({ timeout: 20_000 })
    await shot(pageA, '03-userA-uploaded-new-file')

    // Capture User A's actual object key via the API (same session/cookies).
    const filesResA = await pageA.request.get('/api/gate-keep/files')
    const { files: filesA } = await filesResA.json() as { files: { key: string; filename: string }[] }
    console.log(`  ℹ  User A has ${filesA.length} file(s):`, filesA.map(f => f.filename))
    expect(filesA.length).toBeGreaterThanOrEqual(2)
    expect(filesA.every(f => f.key.startsWith(`gate-keep/${USER_A.org}/`))).toBe(true)
    const userAKey = filesA[0].key

    await ctxA.close()

    // ── User B: log in fresh, confirm they do NOT see User A's files ──
    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await login(pageB, USER_B.email, USER_B.password)
    console.log('  ✓  User B logged in')

    await pageB.goto('/gate-keep')
    await expect(pageB.getByText('Your stored files')).toBeVisible({ timeout: 20_000 })
    await shot(pageB, '04-userB-gate-keep-page')

    // User B must not see User A's migrated screenshot anywhere on the page.
    await expect(pageB.getByText(/Screenshot_27-8-2026_171916_/)).toHaveCount(0)
    await expect(pageB.getByText('userA-test-upload.txt')).toHaveCount(0)
    console.log('  ✓  User B does NOT see User A\'s files in the UI')

    const filesResB = await pageB.request.get('/api/gate-keep/files')
    const { files: filesB } = await filesResB.json() as { files: { key: string; filename: string }[] }
    console.log(`  ℹ  User B has ${filesB.length} file(s):`, filesB.map(f => f.filename))
    expect(filesB.some(f => f.key === userAKey)).toBe(false)
    expect(filesB.every(f => f.key.startsWith(`gate-keep/${USER_B.org}/`))).toBe(true)

    // Direct API probe: User B's own authenticated session tries to download
    // User A's real key. Must be refused, not silently served.
    const crossRes = await pageB.request.get(`/api/gate-keep/download?key=${encodeURIComponent(userAKey)}`)
    console.log(`  ℹ  Cross-user download attempt status: ${crossRes.status()}`)
    expect(crossRes.status()).toBe(404)
    console.log('  ✓  User B cannot fetch a download URL for User A\'s file (404, not leaked)')

    // User B can still upload and download their own file normally.
    const testFilePathB = path.join(SS_DIR, 'userB-test-upload.txt')
    fs.writeFileSync(testFilePathB, 'Gate-Keep isolation test — User B file.\n')
    await pageB.locator('input[type="file"]').setInputFiles(testFilePathB)
    await pageB.getByRole('button', { name: /Upload 1 file/ }).click()
    await expect(pageB.getByText('1 file uploaded successfully.')).toBeVisible({ timeout: 20_000 })
    await shot(pageB, '05-userB-uploaded-own-file')

    const ownRes = await pageB.request.get(`/api/gate-keep/download?key=${encodeURIComponent(filesB[0]?.key ?? '')}`)
    if (filesB.length > 0) {
      expect(ownRes.status()).toBe(200)
      console.log('  ✓  User B can still generate a download URL for their own file')
    }

    await ctxB.close()
    console.log(`\n  Screenshots saved to: ${SS_DIR}`)
  })
})
