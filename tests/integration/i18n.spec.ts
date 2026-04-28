import { test, expect } from '../helpers/extension';
import type { BrowserContext, Page } from '@playwright/test';

const FIXTURE_URL = (name: string) => `http://localhost:3000/${name}.html`;
const PII_TEXT = 'Max Mustermann, max@test.de';

async function openPopup(context: BrowserContext, extensionId: string) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  return popup;
}

async function openOnboarding(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
  return page;
}

async function sendRuntimeMessage<T = Record<string, unknown>>(popup: Page, message: Record<string, unknown>): Promise<T> {
  return popup.evaluate((payload) => new Promise<T>((resolve) => {
    chrome.runtime.sendMessage(payload, resolve);
  }), message);
}

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

const POPUP_LOCALES = [
  { locale: 'en-US', mode: 'Mode', simpleModel: 'Simple Mode model', readyToDownload: 'Ready to download' },
  { locale: 'de-DE', mode: 'Modus', simpleModel: 'Simple Mode Modell', readyToDownload: 'Bereit zum Download' },
  { locale: 'fr-FR', mode: 'Mode', simpleModel: 'Modèle du mode simple', readyToDownload: 'Prêt à télécharger' },
  { locale: 'es-ES', mode: 'Modo', simpleModel: 'Modelo del modo simple', readyToDownload: 'Listo para descargar' },
  { locale: 'it-IT', mode: 'Modalità', simpleModel: 'Modello modalità semplice', readyToDownload: 'Pronto per il download' },
  { locale: 'nl-NL', mode: 'Modus', simpleModel: 'Simple Mode-model', readyToDownload: 'Klaar om te downloaden' },
  { locale: 'pl-PL', mode: 'Mode', simpleModel: 'Simple Mode model', readyToDownload: 'Ready to download' },
] as const;

for (const expected of POPUP_LOCALES) {
  test.describe(`popup i18n ${expected.locale}`, () => {
    test.use({ extensionLocale: expected.locale });

    test(`localizes popup chrome for ${expected.locale}`, async ({ context, extensionId }) => {
      const popup = await openPopup(context, extensionId);

      await expect(popup.locator('.popup-mode-section h2')).toContainText(expected.mode);
      await expect(popup.locator('h2', { hasText: expected.simpleModel })).toBeVisible();
      await expect(popup.locator('#simple-status-value')).toContainText(expected.readyToDownload);

      await popup.close();
    });
  });
}

const ONBOARDING_LOCALES = [
  {
    locale: 'en-US',
    title: 'Choose your protection mode',
    recommended: 'Recommended',
    start: 'Start with Reversible',
  },
  {
    locale: 'de-DE',
    title: 'Schutzmodus wählen',
    recommended: 'Empfohlen',
    start: 'Mit Reversible starten',
  },
] as const;

for (const expected of ONBOARDING_LOCALES) {
  test.describe(`onboarding i18n ${expected.locale}`, () => {
    test.use({ extensionLocale: expected.locale });

    test(`localizes onboarding chrome for ${expected.locale}`, async ({ context, extensionId }) => {
      const onboarding = await openOnboarding(context, extensionId);

      await expect(onboarding.locator('h1')).toContainText(expected.title);
      await expect(onboarding.locator('.onboarding-badge')).toContainText(expected.recommended);
      await expect(onboarding.locator('#onboarding-start')).toContainText(expected.start);

      await onboarding.close();
    });
  });
}

test.describe('content i18n de-DE', () => {
  test.use({ extensionLocale: 'de-DE' });

  test('localizes badge, paste status, and notification banner', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL('chatgpt'));

    const badge = page.locator('#pii-shield-badge');
    await expect(badge).toHaveAttribute('title', /PII Shield aktiv/);

    await syntheticPaste(page, '#prompt-textarea', PII_TEXT);
    await expect(page.locator('#pii-shield-paste-status')).toContainText('prüft das Einfügen', {
      timeout: 5_000,
    });
    await expect(page.locator('#pii-shield-banner')).toContainText('PII-Element', {
      timeout: 5_000,
    });

    await page.close();
  });
});

test.describe('content i18n nl-NL', () => {
  test.use({ extensionLocale: 'nl-NL' });

  test('localizes the manual Simple Mode decision dialog', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    await sendRuntimeMessage(popup, { type: 'SET_MODE', mode: 'simple' });
    await sendRuntimeMessage(popup, {
      type: 'TEST_SET_SIMPLE_MODEL_STATE',
      permissionGranted: true,
      cached: false,
      ready: false,
    });
    await popup.close();

    const page = await context.newPage();
    await page.goto(FIXTURE_URL('chatgpt'));
    await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

    await syntheticPaste(page, '#prompt-textarea', PII_TEXT);

    await expect(page.locator('#pii-shield-decision-title')).toContainText('kon niet lokaal maskeren', {
      timeout: 5_000,
    });
    await expect(page.locator('.pii-shield-decision-cancel')).toContainText('Annuleren');

    await page.close();
  });
});
