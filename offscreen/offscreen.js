import * as ort from './vendor/ort.bundle.min.mjs';

const ONNX_RUNTIME = ort.default || ort;
ONNX_RUNTIME.env.wasm.wasmPaths = chrome.runtime.getURL('offscreen/vendor/');
ONNX_RUNTIME.env.wasm.proxy = false;
globalThis[Symbol.for('onnxruntime')] = ONNX_RUNTIME;

const { env, pipeline } = await import('./vendor/transformers.js');

const MODEL_ID = 'openai/privacy-filter';
const MODEL_REVISION = '7ffa9a043d54d1be65afb281eddf0ffbe629385b';
const MODEL_SOURCE = 'huggingface';
const RUNTIME = 'webgpu';

env.allowRemoteModels = true;
env.allowLocalModels = false;
env.remoteHost = 'https://huggingface.co/';
env.remotePathTemplate = '{model}/resolve/{revision}/';
env.useBrowserCache = true;
env.backends.onnx = ONNX_RUNTIME.env;

let classifier = null;
let classifierPromise = null;
let loading = false;
let lastError = null;
let modelProgress = {
  downloadState: 'idle',
  progress: null,
  loadedBytes: null,
  totalBytes: null,
  currentFile: null,
};

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
  if (/quota|QuotaExceeded/i.test(message)) {
    return createError('simple_model_cache_quota_exceeded', message, error);
  }
  if (/Failed to fetch|Load failed|NetworkError|404|403|not found|CORS/i.test(message)) {
    return createError('simple_model_download_failed', 'The Privacy Filter model could not be downloaded.', error);
  }
  if (/webgpu/i.test(message)) {
    return createError('webgpu_unavailable', message, error);
  }

  return createError(fallbackCode, message || fallbackCode, error);
}

function updateModelProgress(patch) {
  modelProgress = {
    ...modelProgress,
    ...patch,
  };
}

function normalizeProgressValue(progress, loaded, total) {
  if (Number.isFinite(progress)) {
    return progress > 1 ? progress / 100 : progress;
  }
  if (Number.isFinite(loaded) && Number.isFinite(total) && total > 0) {
    return loaded / total;
  }
  return null;
}

function handleModelProgress(event) {
  const loaded = Number.isFinite(event?.loaded) ? event.loaded : null;
  const total = Number.isFinite(event?.total) ? event.total : null;
  const progress = normalizeProgressValue(event?.progress, loaded, total);
  const status = String(event?.status || '');

  updateModelProgress({
    downloadState: status === 'download' || status === 'progress'
      ? 'downloading'
      : loading
        ? 'loading'
        : modelProgress.downloadState,
    progress,
    loadedBytes: loaded,
    totalBytes: total,
    currentFile: event?.file || modelProgress.currentFile,
  });
}

function getStatus() {
  return {
    ready: Boolean(classifier),
    loading,
    lastError,
    runtime: RUNTIME,
    source: MODEL_SOURCE,
    modelRevision: MODEL_REVISION,
    ...modelProgress,
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
  updateModelProgress({
    downloadState: 'loading',
    progress: null,
    loadedBytes: null,
    totalBytes: null,
    currentFile: null,
  });

  classifierPromise = pipeline('token-classification', MODEL_ID, {
    device: RUNTIME,
    dtype: 'q4',
    revision: MODEL_REVISION,
    progress_callback: handleModelProgress,
  })
    .then((instance) => {
      classifier = instance;
      lastError = null;
      updateModelProgress({
        downloadState: 'ready',
        progress: 1,
        loadedBytes: null,
        totalBytes: null,
        currentFile: null,
      });
      return classifier;
    })
    .catch((error) => {
      const normalized = normalizeOffscreenError(error, 'simple_model_init_failed');
      lastError = normalized.code;
      updateModelProgress({
        downloadState: 'error',
      });
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
