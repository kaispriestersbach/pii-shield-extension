/**
 * Copy-Interception – De-Anonymisierungstest für alle 7 Chatbot-Fixtures.
 *
 * Szenario S5: Nach einem Paste mit PII (der localMappings befüllt) werden
 * beim Kopieren eines Chatbot-Textes mit Fake-Daten die Originaldaten
 * wiederhergestellt und das De-Anonymisierungs-Banner gezeigt.
 *
 * Ablauf pro Chatbot:
 *   1. Paste mit PII → localMappings werden befüllt (fake → original)
 *   2. Response-Bereich erhält Text mit Fake-Namen
 *   3. Synthetisches Copy-Event auf dem Response-Bereich
 *   4. Prüfung: DataTransfer enthält Originaldaten
 *   5. Prüfung: De-Anonymisierungs-Banner erscheint
 */

import { test, expect } from '../helpers/extension';
import type { Page } from '@playwright/test';

const FIXTURE_URL = (name: string) => `http://localhost:3000/${name}.html`;

const PII_TEXT = 'Max Mustermann, max@test.de';
// Mock gibt diese Fake-Namen zurück (deterministisch aus background.mock.js)
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
 * Setzt den Inhalt des Response-Bereichs, selektiert ihn vollständig und
 * dispatcht ein synthetisches Copy-Event. Gibt den Text zurück, den
 * content.js in den DataTransfer geschrieben hat.
 */
async function syntheticCopyFromResponseArea(
  page: Page,
  responseText: string
): Promise<string> {
  return page.evaluate((text) => {
    const area = document.getElementById('response-area');
    if (!area) return '';

    // Response-Bereich mit Fake-Text befüllen
    area.textContent = text;

    // Text vollständig selektieren
    const range = document.createRange();
    range.selectNodeContents(area);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    // Synthetisches Copy-Event
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
  test(`${bot.name} – S5: Copy de-anonymisiert Fake-Namen`, async ({ context }) => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL(bot.name));
    await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

    // Schritt 1: Paste mit PII → localMappings werden befüllt
    await syntheticPaste(page, bot.selector, PII_TEXT);

    // Auf Banner warten → Paste-Verarbeitung (async) ist abgeschlossen
    await expect(page.locator('#pii-shield-banner')).toHaveClass(
      /pii-shield-banner-visible/,
      { timeout: 5_000 }
    );

    // Schritt 2+3: Response-Bereich mit Fake-Namen befüllen und kopieren
    const copiedText = await syntheticCopyFromResponseArea(page, FAKE_RESPONSE);

    // Schritt 4: DataTransfer enthält wiederhergestellte Originaldaten
    expect(copiedText).toContain('Max Mustermann');
    expect(copiedText).not.toContain('Thomas Weber');

    // Schritt 5: De-Anonymisierungs-Banner erscheint
    await expect(page.locator('#pii-shield-banner')).toHaveClass(
      /pii-shield-banner-deanonymized/,
      { timeout: 3_000 }
    );

    await page.close();
  });
}
