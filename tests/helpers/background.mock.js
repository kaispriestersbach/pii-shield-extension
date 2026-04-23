/**
 * Mock Service Worker for Playwright integration tests.
 * Replaces background.js (which requires Gemini Nano / Chrome Built-in AI).
 *
 * Deterministic substitutions so test assertions are predictable:
 *   "Max Mustermann" ↔ "Thomas Weber"
 *   "max@test.de"    ↔ "t.weber@example.com"
 */

'use strict';

const ANONYMIZE_DELAY_MS = 180;

const REPLACEMENTS = {
  'Max Mustermann': 'Thomas Weber',
  'max@test.de': 't.weber@example.com',
};

const REVERSE_REPLACEMENTS = Object.fromEntries(
  Object.entries(REPLACEMENTS).map(([k, v]) => [v, k])
);

function applyMap(text, map) {
  let result = text;
  for (const [from, to] of Object.entries(map)) {
    result = result.split(from).join(to);
  }
  return result;
}

function hasPII(text) {
  return Object.keys(REPLACEMENTS).some(k => text.includes(k));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'ANONYMIZE_TEXT': {
      setTimeout(() => {
        const found = hasPII(message.text);
        if (!found) {
          sendResponse({ hasPII: false, anonymizedText: message.text, replacements: {} });
          return;
        }
        const anonymizedText = applyMap(message.text, REPLACEMENTS);
        sendResponse({ hasPII: true, anonymizedText, replacements: REPLACEMENTS });
      }, ANONYMIZE_DELAY_MS);
      return true;
    }
    case 'DEANONYMIZE_TEXT': {
      const deanonymizedText = applyMap(message.text, REVERSE_REPLACEMENTS);
      sendResponse({ deanonymizedText });
      return false;
    }
    case 'GET_STATUS':
      sendResponse({ enabled: true });
      return false;
    case 'CLEAR_ALL_MAPPINGS':
      sendResponse({ success: true });
      return false;
    default:
      sendResponse({});
      return false;
  }
});
