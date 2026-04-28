/**
 * Paste interception integration tests for supported chatbot fixtures.
 *
 * Scenarios per chatbot:
 *   S1 - badge appears after DOM load
 *   S2 - paste with PII: text is anonymized and banner appears
 *   S3 - paste without PII: text appears unchanged and no banner appears
 *   S4 - extension disabled: PII stays unfiltered
 */

import { test, expect } from '../helpers/extension';
import type { BrowserContext, Page } from '@playwright/test';

const FIXTURE_URL = (name: string) => `http://localhost:3000/${name}.html`;

const PII_TEXT  = 'Max Mustermann, max@test.de';
const SAFE_TEXT = 'Hello, how are you today? This is a long sentence.';
const SHORT_TIMEOUT_STRUCTURED_TEXT = 'Contact [timeout] max@test.de before sending the answer.';
const SHORT_TIMEOUT_UNSTRUCTURED_TEXT = 'Please review [timeout] this text for hidden personal details.';
const LONG_STRUCTURED_TEXT = `${'Please review this paragraph carefully. '.repeat(120)}

Contact max@test.de before sending the final answer.`;

const CHATBOTS = [
  { name: 'chatgpt',     selector: '#prompt-textarea',   type: 'contenteditable' },
  { name: 'claude',      selector: '.ProseMirror',       type: 'contenteditable' },
  { name: 'gemini',      selector: '.ql-editor',         type: 'contenteditable' },
  { name: 'mistral',     selector: 'textarea',           type: 'textarea' },
  { name: 'copilot',     selector: 'textarea',           type: 'textarea' },
  { name: 'deepseek',    selector: 'textarea',           type: 'textarea' },
  { name: 'perplexity',  selector: 'textarea',           type: 'textarea' },
  { name: 'grok',        selector: 'textarea',           type: 'textarea' },
  { name: 'poe',         selector: 'textarea',           type: 'textarea' },
  { name: 'meta',        selector: '[contenteditable]',  type: 'contenteditable' },
  { name: 'huggingface', selector: 'textarea',           type: 'textarea' },
  { name: 'phind',       selector: 'textarea',           type: 'textarea' },
  { name: 'you',         selector: 'textarea',           type: 'textarea' },
  { name: 'qwen',        selector: 'textarea',           type: 'textarea' },
] as const;

/**
 * Dispatches a synthetic paste event on the given element. The ClipboardEvent
 * contains text in DataTransfer so content.js can read it through
 * `event.clipboardData.getData('text/plain')`.
 */
async function syntheticPaste(page: Page, selector: string, text: string) {
  await page.evaluate(
    ({ sel, pasteText }) => {
      const el = (document.querySelector(sel) ?? document.body) as HTMLElement;
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', pasteText);
      el.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        })
      );
    },
    { sel: selector, pasteText: text }
  );
}

/** Returns visible element text (textarea.value or innerText). */
async function editorText(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return '';
    return (el as HTMLTextAreaElement).value ?? el.innerText ?? '';
  }, selector);
}

async function openPopup(context: BrowserContext, extensionId: string) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  return popup;
}

async function sendRuntimeMessage<T = Record<string, unknown>>(popup: Page, message: Record<string, unknown>): Promise<T> {
  return popup.evaluate((payload) => new Promise<T>((resolve) => {
    chrome.runtime.sendMessage(payload, resolve);
  }), message);
}

for (const bot of CHATBOTS) {
  test.describe(`${bot.name}`, () => {
    test('S1: badge is visible after DOM load', async ({ context }) => {
      const page = await context.newPage();
      await page.goto(FIXTURE_URL(bot.name));
      await expect(page.locator('#pii-shield-badge')).toBeVisible({ timeout: 5_000 });
      await page.close();
    });

    test('S2: paste with PII anonymizes text and shows banner', async ({ context }) => {
      const page = await context.newPage();
      await page.goto(FIXTURE_URL(bot.name));
      await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

      await syntheticPaste(page, bot.selector, PII_TEXT);
      const pasteStatus = page.locator('#pii-shield-paste-status');
      await expect(pasteStatus).toHaveClass(/pii-shield-paste-status-visible/, { timeout: 5_000 });

      // Banner appears with anonymization notice.
      const banner = page.locator('#pii-shield-banner');
      await expect(banner).toHaveClass(/pii-shield-banner-visible/, { timeout: 5_000 });
      await expect(banner).toContainText('PII item');
      await expect(pasteStatus).not.toHaveClass(/pii-shield-paste-status-visible/, { timeout: 5_000 });

      // The editor contains the fake name, not the original.
      const text = await editorText(page, bot.selector);
      expect(text).toContain('Thomas Weber');
      expect(text).not.toContain('Max Mustermann');

      await page.close();
    });

    test('S3: paste without PII keeps text unchanged and shows no banner', async ({ context }) => {
      const page = await context.newPage();
      await page.goto(FIXTURE_URL(bot.name));
      await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

      await syntheticPaste(page, bot.selector, SAFE_TEXT);
      const pasteStatus = page.locator('#pii-shield-paste-status');
      await expect(pasteStatus).toHaveClass(/pii-shield-paste-status-visible/, { timeout: 5_000 });
      await expect
        .poll(async () => editorText(page, bot.selector), { timeout: 5_000 })
        .toContain(SAFE_TEXT.slice(0, 20));
      await expect(pasteStatus).not.toHaveClass(/pii-shield-paste-status-visible/, { timeout: 5_000 });

      // No banner element is created.
      await expect(page.locator('#pii-shield-banner')).toHaveCount(0);

      await page.close();
    });

    test('S4: disabled extension leaves PII unfiltered', async ({ context }) => {
      const page = await context.newPage();
      await page.goto(FIXTURE_URL(bot.name));

      const badge = page.locator('#pii-shield-badge');
      await badge.waitFor({ timeout: 5_000 });
      await badge.click(); // disable

      await expect(badge).toHaveClass(/pii-shield-badge-disabled/, { timeout: 2_000 });

      await syntheticPaste(page, bot.selector, PII_TEXT);

      // Disabled extension: no anonymized banner and no intervention.
      const banner = page.locator('#pii-shield-banner');
      // The click itself shows an info banner, so only check that no
      // anonymized banner appears.
      await expect(banner).not.toHaveClass(/pii-shield-banner-anonymized/);

      await page.close();
    });
  });
}

test('long paste timeout inserts deterministic fallback and shows Simple Mode CTA', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE_URL('chatgpt'));
  await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

  await syntheticPaste(page, '#prompt-textarea', LONG_STRUCTURED_TEXT);

  const banner = page.locator('#pii-shield-banner');
  await expect(banner).toHaveClass(/pii-shield-banner-partial/, { timeout: 5_000 });
  await expect(banner).toContainText('partial check');
  await expect(page.locator('#pii-shield-action')).toContainText('Simple Mode');

  const text = await editorText(page, '#prompt-textarea');
  expect(text).toContain('t.weber@example.com');
  expect(text).not.toContain('max@test.de');

  await page.close();
});

test('short paste timeout inserts deterministic fallback and shows Simple Mode CTA', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE_URL('mistral'));
  await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

  await syntheticPaste(page, 'textarea', SHORT_TIMEOUT_STRUCTURED_TEXT);

  const banner = page.locator('#pii-shield-banner');
  await expect(banner).toHaveClass(/pii-shield-banner-partial/, { timeout: 5_000 });
  await expect(banner).toContainText('partial check');
  await expect(page.locator('#pii-shield-action')).toContainText('Simple Mode');

  const text = await editorText(page, 'textarea');
  expect(text).toContain('t.weber@example.com');
  expect(text).not.toContain('max@test.de');

  await page.close();
});

test('short paste timeout without deterministic hits stays blocked', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE_URL('mistral'));
  await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

  await syntheticPaste(page, 'textarea', SHORT_TIMEOUT_UNSTRUCTURED_TEXT);

  const banner = page.locator('#pii-shield-banner');
  await expect(banner).toHaveClass(/pii-shield-banner-info/, { timeout: 5_000 });
  await expect(banner).toContainText('Paste blocked');
  await expect(banner).toContainText('too long');

  const text = await editorText(page, 'textarea');
  expect(text).toBe('');

  await page.close();
});

test('partial paste CTA remasks the current textarea paste with ready Simple Mode', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);
  await sendRuntimeMessage(popup, {
    type: 'TEST_SET_SIMPLE_MODEL_STATE',
    permissionGranted: true,
    cached: true,
    ready: true,
  });
  await popup.close();

  const page = await context.newPage();
  await page.goto(FIXTURE_URL('mistral'));
  await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });
  await syntheticPaste(page, 'textarea', LONG_STRUCTURED_TEXT);

  await expect(page.locator('#pii-shield-banner')).toHaveClass(/pii-shield-banner-partial/, {
    timeout: 5_000,
  });
  await page.locator('#pii-shield-action').click();
  await expect(page.locator('#pii-shield-banner')).toContainText('remasked with Simple Mode', {
    timeout: 5_000,
  });

  const text = await editorText(page, 'textarea');
  expect(text).toContain('<PRIVATE_EMAIL>');
  expect(text).not.toContain('t.weber@example.com');
  expect(text).not.toContain('max@test.de');

  await page.close();
});
