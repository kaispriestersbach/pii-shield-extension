/**
 * Playwright-Fixture das eine echte Chrome-Extension in einen isolierten
 * Chromium-Kontext lädt.
 *
 * Ablauf:
 *  1. Baut test-build/ aus manifest.test.json + background.mock.js
 *  2. Startet Chromium mit --load-extension=test-build/
 *  3. Wartet auf den Service Worker und liefert extensionId
 */

import { test as base, chromium } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const TEST_BUILD = path.join(ROOT, 'test-build');

/** Dateien die aus dem Extension-Root ins test-build kopiert werden. */
const COPY_FILES: Array<[string, string]> = [
  ['manifest.test.json',        'manifest.json'],
  ['tests/helpers/background.mock.js', 'background.js'],
  ['content.js',                'content.js'],
  ['replacement-engine.js',     'replacement-engine.js'],
];
const COPY_DIRS: Array<[string, string]> = [
  ['styles', 'styles'],
  ['popup',  'popup'],
  ['icons',  'icons'],
];

function buildTestExtension(): string {
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

  return TEST_BUILD;
}

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
};

export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const extensionPath = buildTestExtension();
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pii-shield-playwright-')
    );

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
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
