import { test, expect, Page } from '@playwright/test'
import * as fs   from 'fs'
import * as os   from 'os'
import * as path from 'path'

// Gate-Keep archive: folders, uploads, move/rename, delete, and
// isolation between workspaces. Runs against real infrastructure (the
// theoflow-gate-keep-archive bucket and the daai-insure-gate-keep table), so the
// terraform in daai-insure-platform/infrastructure/terraform/{gate-keep,cognito}
// must be applied first.
//
// Accounts come from the environment, never from this file:
//   GK_USER_A_EMAIL / GK_USER_A_PASSWORD   (required)
//   GK_USER_B_EMAIL / GK_USER_B_PASSWORD   (optional; enables the isolation test)
const A = { email: process.env.GK_USER_A_EMAIL, password: process.env.GK_USER_A_PASSWORD }
const B = { email: process.env.GK_USER_B_EMAIL, password: process.env.GK_USER_B_PASSWORD }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-e2e-'))

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => url.pathname === '/dashboard', { timeout: 30_000 })
}

// fetch() from inside the page, so it carries the session cookie and the browser's TLS trust.
async function api<T = unknown>(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(url, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }, { method, url, body }) as Promise<{ status: number; body: T }>
}

async function openArchive(page: Page) {
  await page.goto('/gate-keep')
  await expect(page.getByText('Your stored files')).toBeVisible({ timeout: 20_000 })
}

async function uploadTextFile(page: Page, name: string) {
  const p = path.join(TMP, name)
  fs.writeFileSync(p, `Gate-Keep e2e file ${name}\n`)
  await page.locator('input[type="file"]').setInputFiles(p)
  await page.getByRole('button', { name: /Upload 1 file/ }).click()
  await expect(page.getByText('1 file uploaded successfully.')).toBeVisible({ timeout: 30_000 })
}

// Only rows of the stored list (<li>), not the upload widget's own copy of the name or a toast.
const row       = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) })
const rowMenu   = (page: Page, name: string) => page.getByRole('button', { name: `Actions for ${name}` })
const openFolder = (page: Page, name: string) => page.getByRole('button', { name: `Open folder ${name}` })

// Click a folder and wait until it is really open, so nothing runs against the previous folder.
async function enter(page: Page, name: string) {
  await openFolder(page, name).click()
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'New folder' })).toBeEnabled({ timeout: 15_000 })
}

async function newFolder(page: Page, name: string) {
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByLabel('Folder name').fill(name)
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click()
  await expect(openFolder(page, name)).toBeVisible({ timeout: 15_000 })
}

type ListBody = { folders: { id: string; name: string }[]; files: { id: string; name: string }[]; tree: { id: string; parentId: string; name: string }[] }

// Best-effort cleanup through the API, so a failed assertion never leaves files behind.
async function cleanup(page: Page, folderName: string) {
  const root = (await api<ListBody>(page, 'GET', '/api/gate-keep/list')).body
  const top = root?.folders.find(f => f.name === folderName)
  if (!top) return
  const ids = new Set<string>([top.id])
  for (let grew = true; grew;) {
    grew = false
    for (const n of root.tree) if (ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); grew = true }
  }
  for (const id of Array.from(ids)) {
    const inFolder = (await api<ListBody>(page, 'GET', `/api/gate-keep/list?folder=${id}`)).body
    for (const f of inFolder?.files ?? []) await api(page, 'DELETE', `/api/gate-keep/files/${f.id}`)
  }
  // deepest folders first (children must go before their parent, whatever order the list came back in)
  const depth = (id: string): number => { const n = root.tree.find(x => x.id === id); return n && ids.has(n.parentId) ? 1 + depth(n.parentId) : 0 }
  for (const n of root.tree.filter(n => ids.has(n.id)).sort((a, b) => depth(b.id) - depth(a.id))) {
    await api(page, 'DELETE', `/api/gate-keep/folders/${n.id}`)
  }
}

// Anything a test file left at the top level (e.g. after a failed run) is removed by name pattern.
async function sweep(page: Page) {
  const root = (await api<ListBody>(page, 'GET', '/api/gate-keep/list')).body
  for (const f of root?.files ?? []) {
    if (/^(keep|lease|secret)-\d+/.test(f.name)) await api(page, 'DELETE', `/api/gate-keep/files/${f.id}`)
  }
}

test.describe('Gate-Keep archive', () => {
  test.skip(!A.email || !A.password, 'Set GK_USER_A_EMAIL and GK_USER_A_PASSWORD to run these tests.')

  test('folders, upload, move, rename and delete', async ({ browser }) => {
    const stamp = Date.now()
    const top = `e2e-${stamp}`
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, A.email!, A.password!)
    await openArchive(page)

    try {
      // A folder with a subfolder, and a file uploaded into the subfolder.
      await newFolder(page, top)
      await enter(page, top)
      await newFolder(page, 'Contracts')
      await enter(page, 'Contracts')

      const nav = page.getByRole('navigation', { name: 'Breadcrumb' })
      await expect(nav.getByText(top)).toBeVisible()
      await expect(nav.getByText('Contracts')).toBeVisible()

      const file = `lease-${stamp}.txt`
      await uploadTextFile(page, file)
      await expect(row(page, file)).toBeVisible({ timeout: 15_000 })

      // Move it up one level; it leaves this folder and shows in the parent.
      await rowMenu(page, file).click()
      await page.getByRole('menuitem', { name: 'Move to…' }).click()
      await page.getByRole('dialog').getByRole('radio', { name: top }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Move here' }).click()
      await expect(row(page, file)).toHaveCount(0, { timeout: 15_000 })
      await nav.getByRole('button', { name: top }).click()
      await expect(row(page, file)).toBeVisible({ timeout: 15_000 })

      // Rename.
      const renamed = `lease-${stamp}-signed.txt`
      await rowMenu(page, file).click()
      await page.getByRole('menuitem', { name: 'Rename' }).click()
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill(renamed)
      await page.getByRole('button', { name: 'Save' }).click()
      await expect(row(page, renamed)).toBeVisible({ timeout: 15_000 })

      // Delete: asks first, and cancelling changes nothing.
      const list = async () => (await api<ListBody>(page, 'GET', `/api/gate-keep/list?folder=${folderId}`)).body
      const folderId = (await api<ListBody>(page, 'GET', '/api/gate-keep/list')).body.folders.find(f => f.name === top)!.id
      const fileId = (await list()).files.find(f => f.name === renamed)!.id

      await rowMenu(page, renamed).click()
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
      await expect(page.getByRole('dialog').getByText(`"${renamed}" will be deleted for good. This cannot be undone.`)).toBeVisible()
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
      await expect(row(page, renamed)).toBeVisible()
      expect((await api(page, 'GET', `/api/gate-keep/files/${fileId}/download`)).status).toBe(200)

      // Confirm: it is gone at once, with no trash and nothing to restore.
      await rowMenu(page, renamed).click()
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
      // Wait for the confirmation first: while the dialog is closing the rest of the page is hidden
      // from role queries, so a row count of 0 would pass before the request has even been sent.
      await expect(page.getByText(`${renamed} deleted`, { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(row(page, renamed)).toHaveCount(0, { timeout: 15_000 })
      await expect(page.getByRole('tab')).toHaveCount(0)
      await expect(page.getByText(/trash/i)).toHaveCount(0)
      expect((await api(page, 'GET', `/api/gate-keep/files/${fileId}/download`)).status).toBe(404)
      expect((await list()).files.some(f => f.id === fileId)).toBe(false)
    } finally {
      await cleanup(page, top)
      await sweep(page)
      await ctx.close()
    }
  })

  test('a folder must be empty before it can be deleted', async ({ browser }) => {
    const top = `e2e-nonempty-${Date.now()}`
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, A.email!, A.password!)
    await openArchive(page)

    try {
      await newFolder(page, top)
      await enter(page, top)
      await uploadTextFile(page, `keep-${Date.now()}.txt`)
      await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Home' }).click()

      await rowMenu(page, top).click()
      await page.getByRole('menuitem', { name: 'Delete folder' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete folder' }).click()
      await expect(page.getByText('Move or remove everything inside this folder first.', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(openFolder(page, top)).toBeVisible()
    } finally {
      await cleanup(page, top)
      await sweep(page)
      await ctx.close()
    }
  })

  test('the same name cannot be used twice in one folder', async ({ browser }) => {
    const top = `e2e-dupe-${Date.now()}`
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, A.email!, A.password!)
    await openArchive(page)

    try {
      await newFolder(page, top)
      await page.getByRole('button', { name: 'New folder' }).click()
      await page.getByLabel('Folder name').fill(top.toUpperCase())    // names are case-insensitive
      await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click()
      await expect(page.getByText('That name is already used in this folder.', { exact: true })).toBeVisible({ timeout: 15_000 })
    } finally {
      await page.keyboard.press('Escape')
      await cleanup(page, top)
      await sweep(page)
      await ctx.close()
    }
  })

  test.describe('isolation between two workspaces', () => {
    test.skip(!B.email || !B.password, 'Set GK_USER_B_EMAIL and GK_USER_B_PASSWORD (a user in a DIFFERENT organisation) to run this.')

    test('user B cannot see or change anything of user A\'s, on any endpoint', async ({ browser }) => {
      const top = `e2e-iso-${Date.now()}`
      const ctxA = await browser.newContext(); const pageA = await ctxA.newPage()
      const ctxB = await browser.newContext(); const pageB = await ctxB.newPage()
      // Both log in BEFORE anything is written, so a login problem can never leave files behind.
      await login(pageA, A.email!, A.password!)
      await login(pageB, B.email!, B.password!)
      await openArchive(pageA)
      await openArchive(pageB)

      try {
        await newFolder(pageA, top)
        await enter(pageA, top)
        const name = `secret-${Date.now()}.txt`
        await uploadTextFile(pageA, name)
        await expect(row(pageA, name)).toBeVisible({ timeout: 15_000 })

        const rootA = (await api<ListBody>(pageA, 'GET', '/api/gate-keep/list')).body
        const folderId = rootA.folders.find(f => f.name === top)!.id
        const fileId = (await api<ListBody>(pageA, 'GET', `/api/gate-keep/list?folder=${folderId}`)).body.files.find(f => f.name === name)!.id

        // B's own view contains nothing of A's.
        await pageB.reload()
        await expect(pageB.getByText(top, { exact: true })).toHaveCount(0)
        const rootB = (await api<ListBody>(pageB, 'GET', '/api/gate-keep/list')).body
        expect(JSON.stringify(rootB)).not.toContain(folderId)

        // B tries A's ids on every endpoint that takes one: each is "not found".
        const probes = [
          await api(pageB, 'GET',    `/api/gate-keep/list?folder=${folderId}`),
          await api(pageB, 'PATCH',  `/api/gate-keep/folders/${folderId}`, { name: 'stolen' }),
          await api(pageB, 'DELETE', `/api/gate-keep/folders/${folderId}`),
          await api(pageB, 'PATCH',  `/api/gate-keep/files/${fileId}`, { name: 'stolen.txt' }),
          await api(pageB, 'DELETE', `/api/gate-keep/files/${fileId}`),
          await api(pageB, 'GET',    `/api/gate-keep/files/${fileId}/download`),
          await api(pageB, 'POST',   `/api/gate-keep/files/${fileId}/confirm`),
        ]
        expect(probes.map(p => p.status)).toEqual(probes.map(() => 404))

        // ...and A's file is untouched.
        const after = (await api<ListBody>(pageA, 'GET', `/api/gate-keep/list?folder=${folderId}`)).body
        expect(after.files.some(f => f.id === fileId && f.name === name)).toBe(true)
      } finally {
        await cleanup(pageA, top)
        await sweep(pageA)
        await ctxA.close()
        await ctxB.close()
      }
    })
  })
})
