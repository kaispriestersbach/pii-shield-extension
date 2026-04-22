import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,

  // Chrome Extensions brauchen einen seriellen Browser-Kontext
  workers: 1,
  fullyParallel: false,

  use: {
    // Extensions laufen nicht im echten headless-Modus
    headless: false,
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
