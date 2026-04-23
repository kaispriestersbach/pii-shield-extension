import { test, expect } from '../helpers/extension';
import type { BrowserContext, Page } from '@playwright/test';

const FIXTURE_URL = (name: string) => `http://localhost:3000/${name}.html`;
const PII_TEXT = 'Max Mustermann, max@test.de';
const SIMPLE_RESPONSE = '<PRIVATE_PERSON> schrieb an <PRIVATE_EMAIL> eine Nachricht.';

async function openPopup(context: BrowserContext, extensionId: string) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  return popup;
}

async function setMode(context: BrowserContext, extensionId: string, mode: 'reversible' | 'simple') {
  const popup = await openPopup(context, extensionId);
  await popup.locator(mode === 'simple' ? '#mode-simple' : '#mode-reversible').click();
  await expect(
    popup.locator(mode === 'simple' ? '#mode-simple' : '#mode-reversible')
  ).toHaveClass(/popup-mode-btn-active/);
  if (mode === 'simple') {
    await expect(popup.locator('#simple-status-value')).toContainText('Ready', {
      timeout: 5_000,
    });
  }
  await popup.close();
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

async function editorText(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return '';
    return (el as HTMLTextAreaElement).value ?? el.innerText ?? '';
  }, selector);
}

async function syntheticCopyFromResponseArea(page: Page, responseText: string): Promise<string> {
  return page.evaluate((text) => {
    const area = document.getElementById('response-area');
    if (!area) return '';

    area.textContent = text;
    const range = document.createRange();
    range.selectNodeContents(area);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const mirrorDefaultCopy = (event: ClipboardEvent) => {
      if (!event.defaultPrevented && event.clipboardData) {
        event.clipboardData.setData('text/plain', selection?.toString() || '');
      }
      document.removeEventListener('copy', mirrorDefaultCopy);
    };
    document.addEventListener('copy', mirrorDefaultCopy);

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

test('simple mode masks pasted PII with typed placeholders', async ({ context, extensionId }) => {
  await setMode(context, extensionId, 'simple');

  const page = await context.newPage();
  await page.goto(FIXTURE_URL('chatgpt'));
  await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

  await syntheticPaste(page, '#prompt-textarea', PII_TEXT);

  await expect(page.locator('#pii-shield-banner')).toHaveClass(/pii-shield-banner-masked/, {
    timeout: 5_000,
  });

  const text = await editorText(page, '#prompt-textarea');
  expect(text).toContain('<PRIVATE_PERSON>');
  expect(text).toContain('<PRIVATE_EMAIL>');
  expect(text).not.toContain('Max Mustermann');
  expect(text).not.toContain('max@test.de');

  await page.close();
});

test('simple mode does not de-anonymize on copy', async ({ context, extensionId }) => {
  await setMode(context, extensionId, 'simple');

  const page = await context.newPage();
  await page.goto(FIXTURE_URL('chatgpt'));
  await page.locator('#pii-shield-badge').waitFor({ timeout: 5_000 });

  await syntheticPaste(page, '#prompt-textarea', PII_TEXT);
  await expect(page.locator('#pii-shield-banner')).toHaveClass(/pii-shield-banner-masked/, {
    timeout: 5_000,
  });

  const copiedText = await syntheticCopyFromResponseArea(page, SIMPLE_RESPONSE);
  expect(copiedText).toContain('<PRIVATE_PERSON>');
  expect(copiedText).toContain('<PRIVATE_EMAIL>');
  expect(copiedText).not.toContain('Max Mustermann');

  await page.close();
});

test('popup shows simple mode status and hint text', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);

  await popup.locator('#mode-simple').click();
  await expect(popup.locator('#mode-simple')).toHaveClass(/popup-mode-btn-active/);
  await expect(popup.locator('#status-mode')).toContainText('Simple Mode');
  await expect(popup.locator('#simple-status-value')).toContainText('Model is downloading');
  await expect(popup.locator('#simple-status-value')).toContainText('Ready');
  await expect(popup.locator('#mode-hint')).toContainText('typed placeholders');

  await popup.close();
});

test('simple mode permission denial keeps reversible mode active', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);
  await sendRuntimeMessage(popup, {
    type: 'TEST_SET_SIMPLE_MODEL_STATE',
    permissionGranted: false,
    cached: false,
    ready: false,
  });

  const status = await sendRuntimeMessage<{
    mode: string;
    error?: string;
    simpleModeModelState?: { lastError?: string };
  }>(popup, { type: 'SET_MODE', mode: 'simple' });

  expect(status.mode).toBe('reversible');
  expect(status.error).toBe('simple_model_permission_missing');
  expect(status.simpleModeModelState?.lastError).toBe('simple_model_permission_missing');

  await popup.close();
});

test('cached simple model can activate without download permission', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);
  await sendRuntimeMessage(popup, {
    type: 'TEST_SET_SIMPLE_MODEL_STATE',
    permissionGranted: false,
    cached: true,
    ready: false,
  });

  const status = await sendRuntimeMessage<{
    mode: string;
    simpleModeModelState?: { downloadState?: string };
  }>(popup, { type: 'SET_MODE', mode: 'simple' });

  expect(status.mode).toBe('simple');
  expect(status.simpleModeModelState?.downloadState).toBe('loading');

  await popup.close();
});
