/**
 * Playwright fixture that loads the Chrome extension in an isolated Chromium
 * context.
 *
 * Flow:
 *  1. Builds test-build/ from manifest.test.json + background.mock.js.
 *  2. Starts Chromium with --load-extension=test-build/.
 *  3. Waits for the service worker and provides extensionId.
 */

import { test as base, chromium } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const TEST_BUILD = path.join(ROOT, 'test-build');
const SUPPORTED_TEST_LOCALES = new Set(['en', 'de', 'fr', 'es', 'it', 'nl']);

/** Files copied from the extension root into test-build. */
const COPY_FILES: Array<[string, string]> = [
  ['manifest.test.json',        'manifest.json'],
  ['tests/helpers/background.mock.js', 'background.js'],
  ['i18n.js',                   'i18n.js'],
  ['content.js',                'content.js'],
  ['replacement-engine.js',     'replacement-engine.js'],
];
const COPY_DIRS: Array<[string, string]> = [
  ['_locales', '_locales'],
  ['styles', 'styles'],
  ['popup',  'popup'],
  ['icons',  'icons'],
];

function normalizeTestLocale(locale: string): string {
  const language = String(locale || 'en').split('-')[0].toLowerCase();
  return SUPPORTED_TEST_LOCALES.has(language) ? language : 'en';
}

function mirrorRequestedLocaleIntoTestBuild(locale: string) {
  const language = normalizeTestLocale(locale);
  const sourceMessages = path.join(ROOT, '_locales', language, 'messages.json');
  const localesRoot = path.join(TEST_BUILD, '_locales');

  for (const localeDir of fs.readdirSync(localesRoot)) {
    const destination = path.join(localesRoot, localeDir, 'messages.json');
    if (fs.existsSync(destination)) {
      fs.copyFileSync(sourceMessages, destination);
    }
  }
}

function buildTestExtension(locale: string): string {
  fs.mkdirSync(TEST_BUILD, { recursive: true });

  for (const [src, dst] of COPY_FILES) {
    const srcPath = path.join(ROOT, src);
    const dstPath = path.join(TEST_BUILD, dst);
    if (fs.existsSync(srcPath)) {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
    }
  }

  for (const [src, dst] of COPY_DIRS) {
    const srcPath = path.join(ROOT, src);
    const dstPath = path.join(TEST_BUILD, dst);
    if (fs.existsSync(srcPath)) {
      fs.cpSync(srcPath, dstPath, { recursive: true });
    }
  }

  mirrorRequestedLocaleIntoTestBuild(locale);
  return TEST_BUILD;
}

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
  extensionLocale: string;
};

export const test = base.extend<ExtensionFixtures>({
  extensionLocale: ['en-US', { option: true }],

  context: async ({ extensionLocale }, use) => {
    const extensionPath = buildTestExtension(extensionLocale);
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pii-shield-playwright-')
    );

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      locale: extensionLocale,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        `--lang=${extensionLocale}`,
        `--accept-lang=${extensionLocale}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const id = sw.url().split('/')[2];
    await use(id);
  },
});

export { expect } from '@playwright/test';
