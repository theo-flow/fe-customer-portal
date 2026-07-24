import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'on',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chrome',
      use: {
        // Playwright's own managed Chromium, not the system Chrome install --
        // the latter is centrally managed on this fleet and redirects new
        // launches into an already-running session instead of spawning an
        // independent, automatable instance (`chrome.exe --version` reports
        // "Opening in existing browser session"), which hangs Playwright at
        // newPage(). Playwright's bundled browser isn't subject to that.
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        },
      },
    },
  ],
})
