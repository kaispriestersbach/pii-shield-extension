import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,

  // Chrome extensions need a serial browser context.
  workers: 1,
  fullyParallel: false,

  use: {
    // Extension tests run headless via the Playwright Chromium channel.
    headless: true,
  },

  webServer: {
    command: 'npx serve tests/fixtures -p 3000 --no-clipboard',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
});
