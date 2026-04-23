/**
 * Mock Service Worker for Playwright integration tests.
 *
 * The real background uses Gemini Nano and an offscreen Privacy Filter model.
 * This mock keeps the contract stable with deterministic, synchronous values.
 */

'use strict';

const ANONYMIZE_DELAY_MS = 180;

const REPLACEMENTS = {
  'Max Mustermann': 'Thomas Weber',
  'max@test.de': 't.weber@example.com',
};

const SIMPLE_MASKS = {
  'Max Mustermann': '<PRIVATE_PERSON>',
  'max@test.de': '<PRIVATE_EMAIL>',
};

const REVERSE_REPLACEMENTS = Object.fromEntries(
  Object.entries(REPLACEMENTS).map(([original, fake]) => [fake, original])
);

const SIMPLE_MODEL_STATE = {
  staged: true,
  ready: true,
  loading: false,
  lastError: null,
  runtime: 'webgpu',
};

let isEnabled = true;
let mode = 'reversible';
const tabMappings = new Map();

function baseTransformResult(text, overrides = {}) {
  return {
    mode,
    transformType: mode === 'simple' ? 'masked' : 'anonymized',
    outputText: text,
    anonymizedText: text,
    replacements: {},
    hasPII: false,
    displaySummary: {
      count: 0,
      categories: {},
    },
    requiresManualDecision: false,
    manualDecisionReason: null,
    ...overrides,
  };
}

function applyMap(text, map) {
  let result = text;
  for (const [from, to] of Object.entries(map)) {
    result = result.split(from).join(to);
  }
  return result;
}

function hasPII(text) {
  return Object.keys(REPLACEMENTS).some((original) => text.includes(original));
}

function currentStatus() {
  return {
    enabled: isEnabled,
    mode,
    simpleModeModelState: SIMPLE_MODEL_STATE,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = String(sender.tab?.id || message.tabId || 'unknown');

  switch (message.type) {
    case 'ANONYMIZE_TEXT': {
      setTimeout(() => {
        if (!isEnabled) {
          sendResponse(baseTransformResult(message.text));
          return;
        }

        const found = hasPII(message.text);
        if (!found) {
          sendResponse(baseTransformResult(message.text));
          return;
        }

        if (mode === 'simple') {
          sendResponse(baseTransformResult(message.text, {
            hasPII: true,
            outputText: applyMap(message.text, SIMPLE_MASKS),
            anonymizedText: applyMap(message.text, SIMPLE_MASKS),
            displaySummary: {
              count: 2,
              categories: {
                person: 1,
                email: 1,
              },
            },
          }));
          return;
        }

        const anonymizedText = applyMap(message.text, REPLACEMENTS);
        tabMappings.set(tabId, { ...REVERSE_REPLACEMENTS });
        sendResponse(baseTransformResult(message.text, {
          mode: 'reversible',
          transformType: 'anonymized',
          hasPII: true,
          outputText: anonymizedText,
          anonymizedText,
          replacements: { ...REPLACEMENTS },
          displaySummary: {
            count: 2,
            categories: {
              name: 1,
              email: 1,
            },
          },
        }));
      }, ANONYMIZE_DELAY_MS);
      return true;
    }

    case 'DEANONYMIZE_TEXT':
      sendResponse({ deanonymizedText: applyMap(message.text, REVERSE_REPLACEMENTS) });
      return false;

    case 'GET_STATUS':
      sendResponse(currentStatus());
      return false;

    case 'SET_ENABLED': {
      isEnabled = Boolean(message.enabled);
      chrome.storage.local.set({ piiShieldEnabled: isEnabled }).then(() => {
        sendResponse(currentStatus());
      });
      return true;
    }

    case 'SET_MODE': {
      mode = message.mode === 'simple' ? 'simple' : 'reversible';
      tabMappings.clear();
      chrome.storage.local.set({ piiShieldMode: mode }).then(() => {
        sendResponse(currentStatus());
      });
      return true;
    }

    case 'GET_SIMPLE_MODEL_STATUS':
    case 'ENSURE_SIMPLE_MODEL_READY':
      sendResponse({ ...SIMPLE_MODEL_STATE });
      return false;

    case 'GET_AI_STATUS':
    case 'ENSURE_AI_READY':
      sendResponse({
        availability: 'available',
        phase: 'ready',
        progress: 1,
        ready: true,
      });
      return false;

    case 'GET_MAPPINGS':
      sendResponse({ mappings: tabMappings.get(tabId) || {} });
      return false;

    case 'CLEAR_MAPPINGS':
      tabMappings.delete(tabId);
      sendResponse({ success: true });
      return false;

    case 'CLEAR_ALL_MAPPINGS':
      tabMappings.clear();
      sendResponse({ success: true });
      return false;

    default:
      sendResponse({});
      return false;
  }
});
