/**
 * Copy interception de-anonymization test for supported chatbot fixtures.
 *
 * Scenario S5: after a paste with PII populates localMappings, copying chatbot
 * text with fake data restores the original data and shows the
 * de-anonymization banner.
 *
 * Flow per chatbot:
 *   1. Paste with PII populates localMappings (fake -> original).
 *   2. Response area receives text with fake names.
 *   3. Synthetic copy event on the response area.
 *   4. DataTransfer contains original data.
 *   5. De-anonymization banner appears.
 */

import { test, expect } from '../helpers/extension';
import type { Page } from '@playwright/test';

const FIXTURE_URL = (name: string) => `http://localhost:3000/${name}.html`;

const PII_TEXT = 'Max Mustermann, max@test.de';
// The mock returns these fake names deterministically from background.mock.js.
const FAKE_RESPONSE = 'Thomas Weber schrieb an t.weber@example.com eine Nachricht.';

const CHATBOTS = [
  { name: 'chatgpt',     selector: '#prompt-textarea' },
  { name: 'claude',      selector: '.ProseMirror' },
  { name: 'gemini',      selector: '.ql-editor' },
  { name: 'mistral',     selector: 'textarea' },
  { name: 'copilot',     selector: 'textarea' },
  { name: 'deepseek',    selector: 'textarea' },
  { name: 'perplexity',  selector: 'textarea' },
  { name: 'grok',        selector: 'textarea' },
  { name: 'poe',         selector: 'textarea' },
  { name: 'meta',        selector: '[contenteditable]' },
  { name: 'huggingface', selector: 'textarea' },
  { name: 'phind',       selector: 'textarea' },
  { name: 'you',         selector: 'textarea' },
  { name: 'qwen',        selector: 'textarea' },
] as const;

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

/**
 * Sets response-area content, selects it fully, and dispatches a synthetic copy
 * event. Returns the text content.js wrote into DataTransfer.
 */
async function syntheticCopyFromResponseArea(
  page: Page,
  responseText: string
): Promise<string> {
  return page.evaluate((text) => {
    const area = document.getElementById('response-area');
    if (!area) return '';

    // Fill the response area with fake text.
    area.textContent = text;

    // Select all text.
    const range = document.createRange();
    range.selectNodeContents(area);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    // Synthetic copy event.
    const dt = new DataTransfer();
    const ev = new ClipboardEvent('copy', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ev);

    return dt.getData('text/plain');
  }, responseText);
}

for (const bot of CHATBOTS) {
  test(`${bot.name} - S5: copy de-anonymizes fake names`, async ({ context }) => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL(bot.name));
    await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

    // Step 1: paste with PII populates localMappings.
    await syntheticPaste(page, bot.selector, PII_TEXT);

    // Wait for the banner so async paste processing has finished.
    await expect(page.locator('#pii-shield-banner')).toHaveClass(
      /pii-shield-banner-visible/,
      { timeout: 5_000 }
    );

    // Steps 2+3: fill response area with fake names and copy.
    const copiedText = await syntheticCopyFromResponseArea(page, FAKE_RESPONSE);

    // Step 4: DataTransfer contains restored original data.
    expect(copiedText).toContain('Max Mustermann');
    expect(copiedText).not.toContain('Thomas Weber');

    // Step 5: de-anonymization banner appears.
    await expect(page.locator('#pii-shield-banner')).toHaveClass(
      /pii-shield-banner-deanonymized/,
      { timeout: 3_000 }
    );

    await page.close();
  });
}
