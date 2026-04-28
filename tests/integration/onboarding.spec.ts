import { test, expect } from '../helpers/extension';
import type { BrowserContext, Page } from '@playwright/test';

async function openOnboarding(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
  return page;
}

async function sendRuntimeMessage<T = Record<string, unknown>>(page: Page, message: Record<string, unknown>): Promise<T> {
  return page.evaluate((payload) => new Promise<T>((resolve) => {
    chrome.runtime.sendMessage(payload, resolve);
  }), message);
}

async function getStatus(context: BrowserContext, extensionId: string) {
  const page = await openOnboarding(context, extensionId);
  const status = await sendRuntimeMessage<{
    mode: string;
    simpleModeModelState?: {
      downloadState?: string;
      loading?: boolean;
      ready?: boolean;
    };
  }>(page, { type: 'GET_STATUS' });
  await page.close();
  return status;
}

async function stubPermissionRequest(page: Page, granted: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(chrome.permissions, 'request', {
      configurable: true,
      value: (_permissions: unknown, callback?: (granted: boolean) => void) => {
        if (typeof callback === 'function') callback(value);
        return Promise.resolve(value);
      },
    });
  }, granted);
}

test('onboarding defaults to recommended Reversible mode with explanatory copy', async ({ context, extensionId }) => {
  const onboarding = await openOnboarding(context, extensionId);

  await expect(onboarding.locator('#choice-reversible')).toBeChecked();
  await expect(onboarding.locator('#choice-simple')).not.toBeChecked();
  await expect(onboarding.locator('[data-mode-choice="reversible"]')).toHaveClass(/is-selected/);
  await expect(onboarding.locator('[data-mode-choice="simple"]')).not.toHaveClass(/is-selected/);
  await expect(onboarding.locator('.onboarding-badge')).toContainText('Recommended');

  await expect(onboarding.locator('[data-mode-choice="reversible"]')).toContainText('plausible fake data');
  await expect(onboarding.locator('[data-mode-choice="reversible"]')).toContainText('reverse mapping');
  await expect(onboarding.locator('[data-mode-choice="simple"]')).toContainText('<PRIVATE_EMAIL>');
  await expect(onboarding.locator('[data-mode-choice="simple"]')).toContainText('one-way masking');
  await expect(onboarding.getByText('Advantages').first()).toBeVisible();
  await expect(onboarding.getByText('Tradeoffs').first()).toBeVisible();

  await onboarding.close();

  const status = await getStatus(context, extensionId);
  expect(status.mode).toBe('reversible');
});

test('confirming Reversible keeps the selected mode active', async ({ context, extensionId }) => {
  const onboarding = await openOnboarding(context, extensionId);

  await onboarding.locator('#onboarding-start').click();

  await expect.poll(async () => {
    const status = await getStatus(context, extensionId);
    return status.mode;
  }).toBe('reversible');

  if (!onboarding.isClosed()) await onboarding.close();
});

test('confirming Simple activates Simple Mode and starts model warmup', async ({ context, extensionId }) => {
  const onboarding = await openOnboarding(context, extensionId);

  await onboarding.locator('[data-mode-choice="simple"]').click();
  await expect(onboarding.locator('#choice-simple')).toBeChecked();
  await expect(onboarding.locator('#onboarding-start')).toContainText('Start with Simple');

  await onboarding.locator('#onboarding-start').click();

  await expect.poll(async () => {
    const status = await getStatus(context, extensionId);
    const downloadState = status.simpleModeModelState?.downloadState || 'missing';
    return `${status.mode}:${downloadState}`;
  }).toMatch(/^simple:(downloading|ready)$/);

  if (!onboarding.isClosed()) await onboarding.close();
});

test('denied Simple Mode permission keeps Reversible active and shows an inline error', async ({ context, extensionId }) => {
  const onboarding = await openOnboarding(context, extensionId);
  await stubPermissionRequest(onboarding, false);
  await sendRuntimeMessage(onboarding, {
    type: 'TEST_SET_SIMPLE_MODEL_STATE',
    permissionGranted: false,
    cached: false,
    ready: false,
  });

  await onboarding.locator('[data-mode-choice="simple"]').click();
  await onboarding.locator('#onboarding-start').click();

  await expect(onboarding.locator('#onboarding-error')).toContainText('download permission');
  await expect(onboarding.locator('[data-mode-choice="reversible"]')).toHaveClass(/is-selected/);

  const status = await getStatus(context, extensionId);
  expect(status.mode).toBe('reversible');
  expect(status.simpleModeModelState?.downloadState).toBe('permission_missing');

  await onboarding.close();
});
