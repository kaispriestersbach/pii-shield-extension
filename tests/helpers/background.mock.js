/**
 * Mock Service Worker for Playwright integration tests.
 *
 * The real background uses Gemini Nano and an offscreen Privacy Filter model.
 * This mock keeps the contract stable with deterministic, synchronous values.
 */

'use strict';

const ANONYMIZE_DELAY_MS = 180;
const SIMPLE_READY_DELAY_MS = 800;
const LONG_PARTIAL_THRESHOLD = 3000;

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

const INITIAL_SIMPLE_MODEL_STATE = {
  ready: true,
  loading: false,
  cached: true,
  permissionGranted: true,
  downloadState: 'ready',
  progress: 1,
  loadedBytes: null,
  totalBytes: null,
  currentFile: null,
  lastError: null,
  runtime: 'webgpu',
  source: 'huggingface',
  modelRevision: 'test-revision',
};

let isEnabled = true;
let mode = 'reversible';
let simplePermissionGranted = true;
let simpleModelCached = false;
let simpleModelState = {
  ...INITIAL_SIMPLE_MODEL_STATE,
  ready: false,
  cached: false,
  downloadState: 'idle',
  progress: null,
};
let simpleReadyTimer = null;
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
    analysisStatus: 'complete',
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

function shouldReturnPartial(text) {
  return String(text || '').length >= LONG_PARTIAL_THRESHOLD;
}

function simpleModeOffer() {
  return {
    ready: Boolean(simpleModelState.ready),
    cached: Boolean(simpleModelState.cached),
    permissionGranted: Boolean(simplePermissionGranted),
  };
}

function currentStatus() {
  return {
    enabled: isEnabled,
    mode,
    simpleModeModelState: { ...simpleModelState },
  };
}

function setSimpleModelState(patch) {
  simpleModelState = {
    ...simpleModelState,
    ...patch,
    runtime: 'webgpu',
    source: 'huggingface',
    modelRevision: 'test-revision',
  };
}

function stopSimpleReadyTimer() {
  if (simpleReadyTimer) clearTimeout(simpleReadyTimer);
  simpleReadyTimer = null;
}

function startSimpleModelWarmup() {
  if (simpleModelState.ready) return;

  stopSimpleReadyTimer();
  setSimpleModelState({
    ready: false,
    loading: true,
    cached: simpleModelCached,
    permissionGranted: simplePermissionGranted,
    downloadState: simpleModelCached ? 'loading' : 'downloading',
    progress: simpleModelCached ? 1 : 0.18,
    currentFile: simpleModelCached ? null : 'onnx/model_q4.onnx_data',
    lastError: null,
  });

  simpleReadyTimer = setTimeout(() => {
    simpleModelCached = true;
    setSimpleModelState({
      ready: true,
      loading: false,
      cached: true,
      permissionGranted: simplePermissionGranted,
      downloadState: 'ready',
      progress: 1,
      currentFile: null,
      lastError: null,
    });
    simpleReadyTimer = null;
  }, SIMPLE_READY_DELAY_MS);
}

function setSimplePermissionMissing() {
  stopSimpleReadyTimer();
  setSimpleModelState({
    ready: false,
    loading: false,
    cached: false,
    permissionGranted: false,
    downloadState: 'permission_missing',
    progress: null,
    currentFile: null,
    lastError: 'simple_model_permission_missing',
  });
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
          if (!simpleModelState.ready) {
            sendResponse(baseTransformResult(message.text, {
              requiresManualDecision: true,
              manualDecisionReason: simpleModelState.loading
                ? 'simple_model_downloading'
                : simpleModelState.lastError || 'simple_model_unavailable',
            }));
            return;
          }

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

        if (shouldReturnPartial(message.text)) {
          const partialReplacements = {};
          if (message.text.includes('max@test.de')) {
            partialReplacements['max@test.de'] = REPLACEMENTS['max@test.de'];
          }

          const anonymizedText = applyMap(message.text, partialReplacements);
          tabMappings.set(tabId, Object.fromEntries(
            Object.entries(partialReplacements).map(([original, fake]) => [fake, original])
          ));
          sendResponse(baseTransformResult(message.text, {
            mode: 'reversible',
            transformType: 'anonymized',
            hasPII: anonymizedText !== message.text,
            outputText: anonymizedText,
            anonymizedText,
            replacements: { ...partialReplacements },
            displaySummary: {
              count: Object.keys(partialReplacements).length,
              categories: {
                email: Object.keys(partialReplacements).length,
              },
            },
            analysisStatus: 'partial',
            fallbackReason: 'timeout',
            fallbackMode: 'deterministic',
            simpleModeOffer: simpleModeOffer(),
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
      if (message.mode === 'simple' && !simplePermissionGranted && !simpleModelCached) {
        setSimplePermissionMissing();
        sendResponse({
          ...currentStatus(),
          error: 'simple_model_permission_missing',
        });
        return false;
      }

      mode = message.mode === 'simple' ? 'simple' : 'reversible';
      tabMappings.clear();
      if (mode === 'simple') startSimpleModelWarmup();
      chrome.storage.local.set({ piiShieldMode: mode }).then(() => {
        sendResponse(currentStatus());
      });
      return true;
    }

    case 'GET_SIMPLE_MODEL_STATUS':
      sendResponse({ ...simpleModelState });
      return false;

    case 'ENSURE_SIMPLE_MODEL_READY':
      if (!simplePermissionGranted && !simpleModelCached) {
        setSimplePermissionMissing();
      } else {
        startSimpleModelWarmup();
      }
      sendResponse({ ...simpleModelState });
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

    case 'TEST_SET_SIMPLE_MODEL_STATE': {
      stopSimpleReadyTimer();
      simplePermissionGranted = message.permissionGranted !== undefined
        ? Boolean(message.permissionGranted)
        : simplePermissionGranted;
      simpleModelCached = message.cached !== undefined
        ? Boolean(message.cached)
        : simpleModelCached;

      const ready = Boolean(message.ready);
      setSimpleModelState({
        ready,
        loading: false,
        cached: ready || simpleModelCached,
        permissionGranted: simplePermissionGranted,
        downloadState: ready ? 'ready' : simpleModelCached ? 'cached' : 'idle',
        progress: ready ? 1 : null,
        currentFile: null,
        lastError: null,
      });
      sendResponse({ ...simpleModelState });
      return false;
    }

    default:
      sendResponse({});
      return false;
  }
});
