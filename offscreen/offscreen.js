import { env, pipeline } from './vendor/transformers.web.js';

const MODEL_ID = 'openai/privacy-filter';
const RUNTIME = 'webgpu';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('offscreen/vendor/');

let classifier = null;
let classifierPromise = null;
let loading = false;
let lastError = null;

function createError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function normalizeOffscreenError(error, fallbackCode) {
  const message = String(error?.message || error || '');

  if (!globalThis.navigator?.gpu) {
    return createError('webgpu_unavailable', 'WebGPU is not available in the offscreen runtime.', error);
  }
  if (/Failed to fetch|404|not found/i.test(message)) {
    return createError('simple_model_missing', 'The staged Privacy Filter model could not be found.', error);
  }
  if (/webgpu/i.test(message)) {
    return createError('webgpu_unavailable', message, error);
  }

  return createError(fallbackCode, message || fallbackCode, error);
}

function getStatus() {
  return {
    ready: Boolean(classifier),
    loading,
    lastError,
    runtime: RUNTIME,
  };
}

async function ensureClassifier() {
  if (classifier) return classifier;
  if (classifierPromise) return classifierPromise;
  if (!globalThis.navigator?.gpu) {
    throw createError('webgpu_unavailable', 'WebGPU is not available in this browser profile.');
  }

  loading = true;
  lastError = null;

  classifierPromise = pipeline('token-classification', MODEL_ID, {
    device: RUNTIME,
    dtype: 'q4',
  })
    .then((instance) => {
      classifier = instance;
      lastError = null;
      return classifier;
    })
    .catch((error) => {
      const normalized = normalizeOffscreenError(error, 'simple_model_init_failed');
      lastError = normalized.code;
      throw normalized;
    })
    .finally(() => {
      loading = false;
      classifierPromise = null;
    });

  return classifierPromise;
}

function normalizePipelineSpan(span, text) {
  const start = Number(span?.start);
  const end = Number(span?.end);
  const label = String(span?.entity_group || span?.entity || '').replace(/^[BIES]-/, '').trim();

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
    return null;
  }
  if (!label) return null;

  return {
    label,
    start,
    end,
    text: text.slice(start, end),
    score: Number.isFinite(span?.score) ? span.score : null,
  };
}

async function analyzeText(text) {
  const tokenClassifier = await ensureClassifier();

  try {
    const rawOutput = await tokenClassifier(text, {
      aggregation_strategy: 'simple',
    });

    return Array.isArray(rawOutput)
      ? rawOutput.map((span) => normalizePipelineSpan(span, text)).filter(Boolean)
      : [];
  } catch (error) {
    const normalized = normalizeOffscreenError(error, 'simple_analysis_failed');
    lastError = normalized.code;
    throw normalized;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

  (async () => {
    switch (message.type) {
      case 'GET_SIMPLE_MODEL_STATUS':
        sendResponse(getStatus());
        return;

      case 'ENSURE_SIMPLE_MODEL_READY':
        await ensureClassifier();
        sendResponse(getStatus());
        return;

      case 'SIMPLE_ANALYZE_TEXT': {
        const spans = await analyzeText(String(message.text || ''));
        sendResponse({
          ...getStatus(),
          spans,
        });
        return;
      }

      default:
        sendResponse({
          ...getStatus(),
          error: 'unknown_offscreen_message',
        });
    }
  })().catch((error) => {
    sendResponse({
      ...getStatus(),
      error: error?.code || 'offscreen_runtime_error',
      lastError: error?.code || lastError,
    });
  });

  return true;
});
