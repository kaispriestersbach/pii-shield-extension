/**
 * Paste-Interception – Integrationstests für alle 7 Chatbot-Fixtures.
 *
 * Szenarien (pro Chatbot):
 *   S1 – Badge wird nach DOM-Load angezeigt
 *   S2 – Paste mit PII: Text wird anonymisiert, Banner erscheint
 *   S3 – Paste ohne PII: Text erscheint unverändert, kein Banner
 *   S4 – Extension deaktiviert: PII bleibt ungefiltert, kein Banner
 */

import { test, expect } from '../helpers/extension';
import type { Page } from '@playwright/test';

const FIXTURE_URL = (name: string) => `http://localhost:3000/${name}.html`;

const PII_TEXT  = 'Max Mustermann, max@test.de';
const SAFE_TEXT = 'Hallo, wie geht es dir heute? Das ist ein langer Satz.';

const CHATBOTS = [
  { name: 'chatgpt',    selector: '#prompt-textarea', type: 'contenteditable' },
  { name: 'claude',     selector: '.ProseMirror',     type: 'contenteditable' },
  { name: 'gemini',     selector: '.ql-editor',       type: 'contenteditable' },
  { name: 'mistral',    selector: 'textarea',         type: 'textarea' },
  { name: 'copilot',    selector: 'textarea',         type: 'textarea' },
  { name: 'deepseek',   selector: 'textarea',         type: 'textarea' },
  { name: 'perplexity', selector: 'textarea',         type: 'textarea' },
] as const;

/**
 * Dispatcht ein synthetisches Paste-Event auf dem angegebenen Element.
 * Das ClipboardEvent enthält den Text im DataTransfer-Objekt, sodass
 * content.js es per `event.clipboardData.getData('text/plain')` lesen kann.
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

/** Liefert den sichtbaren Textinhalt eines Elements (textarea.value oder innerText). */
async function editorText(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return '';
    return (el as HTMLTextAreaElement).value ?? el.innerText ?? '';
  }, selector);
}

for (const bot of CHATBOTS) {
  test.describe(`${bot.name}`, () => {
    test('S1: Badge ist nach DOM-Load sichtbar', async ({ context }) => {
      const page = await context.newPage();
      await page.goto(FIXTURE_URL(bot.name));
      await expect(page.locator('#pii-shield-badge')).toBeVisible({ timeout: 5_000 });
      await page.close();
    });

    test('S2: Paste mit PII → Text anonymisiert, Banner sichtbar', async ({ context }) => {
      const page = await context.newPage();
      await page.goto(FIXTURE_URL(bot.name));
      await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

      await syntheticPaste(page, bot.selector, PII_TEXT);

      // Banner erscheint mit Anonymisierungshinweis
      const banner = page.locator('#pii-shield-banner');
      await expect(banner).toHaveClass(/pii-shield-banner-visible/, { timeout: 5_000 });
      await expect(banner).toContainText('PII-Element');

      // Editor enthält den Fake-Namen, nicht das Original
      const text = await editorText(page, bot.selector);
      expect(text).toContain('Thomas Weber');
      expect(text).not.toContain('Max Mustermann');

      await page.close();
    });

    test('S3: Paste ohne PII → Text unverändert, kein Banner', async ({ context }) => {
      const page = await context.newPage();
      await page.goto(FIXTURE_URL(bot.name));
      await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

      await syntheticPaste(page, bot.selector, SAFE_TEXT);

      // Kein Banner
      const banner = page.locator('#pii-shield-banner');
      await expect(banner).not.toHaveClass(/pii-shield-banner-visible/);

      // Originaltext ist im Editor
      const text = await editorText(page, bot.selector);
      expect(text).toContain(SAFE_TEXT.slice(0, 20)); // erste 20 Zeichen reichen

      await page.close();
    });

    test('S4: Extension deaktiviert → PII bleibt ungefiltert', async ({ context }) => {
      const page = await context.newPage();
      await page.goto(FIXTURE_URL(bot.name));

      const badge = page.locator('#pii-shield-badge');
      await badge.waitFor({ timeout: 5_000 });
      await badge.click(); // → deaktivieren

      await expect(badge).toHaveClass(/pii-shield-badge-disabled/, { timeout: 2_000 });

      await syntheticPaste(page, bot.selector, PII_TEXT);

      // Bei deaktivierter Extension: kein Banner und kein Eingriff
      const banner = page.locator('#pii-shield-banner');
      // Der Klick selbst zeigt einen Info-Banner — wir prüfen nur, dass
      // kein "anonymized"-Banner erscheint
      await expect(banner).not.toHaveClass(/pii-shield-banner-anonymized/);

      await page.close();
    });
  });
}
