#!/usr/bin/env node

import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const TMP_ROOT = path.join(ROOT, 'benchmarks/.tmp/gemini-long-paste');
const RESULTS_ROOT = path.join(ROOT, 'benchmarks/results');
const ROOT_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const DEFAULT_REPETITIONS = 5;
const SIZE_SPECS = [
  ['1k', 1000],
  ['2k', 2000],
  ['4k', 4000],
  ['8k', 8000],
  ['12k', 12000],
  ['20k', 20000],
];
const OPTIONAL_SIZE_SPEC = ['40k', 40000];

const PII_VALUES = Object.freeze({
  name: 'Max Mustermann',
  email: 'max.mustermann@example.com',
  phone: '+49 170 1234567',
  iban: 'DE89 3704 0044 0532 0130 00',
  credit_card: '4111 1111 1111 1111',
  ip_address: '192.0.2.45',
  date: '1985-03-15',
  address: 'Musterstrasse 42, 10115 Berlin',
  company: 'Muster GmbH',
});

const SETUP_HINTS = [
  'Gemini Nano was not reported as available by the Chrome Prompt API.',
  'Use a persistent profile with the model already downloaded:',
  '  PII_SHIELD_BENCH_PROFILE=/path/to/profile npm run bench:gemini-long-paste',
  'Chrome setup checklist:',
  '  1. Open chrome://flags/#optimization-guide-on-device-model and choose Enabled BypassPerfRequirement.',
  '  2. Open chrome://flags/#prompt-api-for-gemini-nano-multimodal-input and choose Enabled.',
  '  3. Restart Chrome.',
  '  4. Open chrome://components/ and check Optimization Guide On Device Model.',
].join('\n');

function parseArgs(argv) {
  const options = {
    dryRun: false,
    include40k: false,
    repetitions: DEFAULT_REPETITIONS,
    port: 0,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--include-40k') options.include40k = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--repetitions=')) {
      options.repetitions = Math.max(1, Number.parseInt(arg.slice('--repetitions='.length), 10));
    } else if (arg.startsWith('--port=')) {
      options.port = Math.max(0, Number.parseInt(arg.slice('--port='.length), 10));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run bench:gemini-long-paste -- [options]

Options:
  --dry-run          Generate corpus and summary smoke data without Chrome.
  --include-40k      Include the optional 40k character size.
  --repetitions=N    Measured repetitions per input. Default: ${DEFAULT_REPETITIONS}.
  --port=N           Local benchmark page port. Default: random free port.

Environment:
  PII_SHIELD_BENCH_PROFILE   Persistent Chrome profile path.
  PII_SHIELD_CHROME_PATH     Explicit Chrome executable path.
`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestampForFile(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function safeFiller(seed) {
  const words = [
    'project', 'review', 'draft', 'policy', 'workflow', 'context', 'summary',
    'analysis', 'quality', 'timeline', 'planning', 'handoff', 'notes',
    'iteration', 'proposal', 'research', 'document', 'customer', 'support',
    'internal', 'privacy', 'prompt', 'benchmark', 'local', 'browser',
  ];
  let result = '';
  let i = 0;
  while (result.length < seed) {
    result += `${words[i % words.length]} `;
    i += 1;
  }
  return result;
}

function expectedEntries(types = Object.keys(PII_VALUES)) {
  return types.map((type) => ({ type, value: PII_VALUES[type] }));
}

function allPiiSentence() {
  return [
    `Please prepare the contract note for ${PII_VALUES.name}`,
    `at ${PII_VALUES.company}`,
    `using ${PII_VALUES.email}`,
    `and ${PII_VALUES.phone}`,
    `registered at ${PII_VALUES.address}`,
    `with IBAN ${PII_VALUES.iban}`,
    `card ${PII_VALUES.credit_card}`,
    `login IP ${PII_VALUES.ip_address}`,
    `and birth date ${PII_VALUES.date}.`,
  ].join(' ');
}

function noPunctuationPiiBlock() {
  return [
    'please review account for',
    PII_VALUES.name,
    'email',
    PII_VALUES.email,
    'phone',
    PII_VALUES.phone,
    'company',
    PII_VALUES.company,
    'iban',
    PII_VALUES.iban,
    'address',
    PII_VALUES.address,
  ].join(' ');
}

function fitToLength(parts, targetChars) {
  let text = parts.filter(Boolean).join(' ');
  if (text.length > targetChars) {
    return text.slice(0, targetChars);
  }

  let i = 0;
  while (text.length < targetChars) {
    const remaining = targetChars - text.length;
    const chunk = safeFiller(Math.min(remaining + 64, 512));
    const slice = chunk.slice(0, Math.max(0, remaining - 1));
    text += `${text.endsWith(' ') ? '' : ' '}${slice}`;
    i += 1;
    if (i > 1000) break;
  }

  return text.slice(0, targetChars);
}

function buildCase(sizeLabel, targetChars, variant) {
  const base = safeFiller(Math.max(targetChars, 1024));
  const half = Math.max(0, Math.floor((targetChars - allPiiSentence().length) / 2));

  if (variant === 'safe') {
    return {
      id: `${sizeLabel}-safe`,
      sizeLabel,
      targetChars,
      variant,
      text: fitToLength([base], targetChars),
      expected: [],
    };
  }

  if (variant === 'prose-pii') {
    return {
      id: `${sizeLabel}-prose-pii`,
      sizeLabel,
      targetChars,
      variant,
      text: fitToLength([
        'Summarize this customer escalation and produce a neutral response.',
        allPiiSentence(),
        base,
      ], targetChars),
      expected: expectedEntries(),
    };
  }

  if (variant === 'no-punctuation') {
    return {
      id: `${sizeLabel}-no-punctuation`,
      sizeLabel,
      targetChars,
      variant,
      text: fitToLength([safeFiller(Math.floor(targetChars / 3)), noPunctuationPiiBlock(), base], targetChars)
        .replace(/[!?;]/g, ' '),
      expected: expectedEntries(['name', 'email', 'phone', 'company', 'iban', 'address']),
    };
  }

  if (variant === 'pii-start') {
    return {
      id: `${sizeLabel}-pii-start`,
      sizeLabel,
      targetChars,
      variant,
      text: fitToLength([allPiiSentence(), base], targetChars),
      expected: expectedEntries(),
    };
  }

  if (variant === 'pii-middle') {
    return {
      id: `${sizeLabel}-pii-middle`,
      sizeLabel,
      targetChars,
      variant,
      text: fitToLength([base.slice(0, half), allPiiSentence(), base], targetChars),
      expected: expectedEntries(),
    };
  }

  if (variant === 'pii-end') {
    const pii = allPiiSentence();
    const prefixLength = Math.max(0, targetChars - pii.length - 1);
    return {
      id: `${sizeLabel}-pii-end`,
      sizeLabel,
      targetChars,
      variant,
      text: fitToLength([safeFiller(prefixLength).slice(0, prefixLength), pii], targetChars),
      expected: expectedEntries(),
    };
  }

  if (variant === 'pii-boundary') {
    const boundaryOffset = Math.max(0, Math.min(targetChars - allPiiSentence().length - 1, 3920));
    return {
      id: `${sizeLabel}-pii-boundary`,
      sizeLabel,
      targetChars,
      variant,
      text: fitToLength([
        safeFiller(boundaryOffset).slice(0, boundaryOffset),
        allPiiSentence(),
        base,
      ], targetChars),
      expected: expectedEntries(),
    };
  }

  throw new Error(`Unknown variant: ${variant}`);
}

function generateCorpus({ include40k = false } = {}) {
  const sizes = include40k ? [...SIZE_SPECS, OPTIONAL_SIZE_SPEC] : SIZE_SPECS;
  const variants = [
    'prose-pii',
    'no-punctuation',
    'pii-start',
    'pii-middle',
    'pii-end',
    'pii-boundary',
    'safe',
  ];

  return sizes.flatMap(([sizeLabel, targetChars]) => (
    variants.map((variant) => buildCase(sizeLabel, targetChars, variant))
  ));
}

function validateCorpus(corpus) {
  for (const testCase of corpus) {
    if (testCase.text.length !== testCase.targetChars) {
      throw new Error(`${testCase.id} length ${testCase.text.length} did not match ${testCase.targetChars}.`);
    }

    for (const expected of testCase.expected) {
      if (!testCase.text.includes(expected.value)) {
        throw new Error(`${testCase.id} is missing expected ${expected.type} fixture text.`);
      }
    }
  }
}

function benchManifest(port) {
  const matches = [
    `http://127.0.0.1:${port}/*`,
    `http://localhost:${port}/*`,
  ];

  return {
    manifest_version: 3,
    name: 'PII Shield Gemini Long Paste Bench',
    version: ROOT_MANIFEST.version || '0.0.0',
    default_locale: 'en',
    description: 'Local benchmark build for Gemini Nano long-paste measurements.',
    permissions: ['storage', 'unlimitedStorage', 'offscreen'],
    optional_host_permissions: ['https://*.hf.co/*'],
    host_permissions: matches,
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    content_scripts: [
      {
        matches,
        js: ['i18n.js', 'content.js'],
        css: ['styles/content.css'],
        run_at: 'document_start',
      },
    ],
    minimum_chrome_version: ROOT_MANIFEST.minimum_chrome_version || '138',
  };
}

function copyPath(src, dst) {
  ensureDir(path.dirname(dst));
  fs.cpSync(src, dst, { recursive: true });
}

function buildBenchExtension(port) {
  const extensionDir = path.join(TMP_ROOT, 'extension');
  fs.rmSync(extensionDir, { recursive: true, force: true });
  ensureDir(extensionDir);

  const files = [
    'background.js',
    'i18n.js',
    'content.js',
    'replacement-engine.js',
    'masking-engine.js',
    'pii-detectors.js',
    'long-paste-chunker.js',
  ];
  const dirs = ['_locales', 'styles'];

  for (const file of files) {
    copyPath(path.join(ROOT, file), path.join(extensionDir, file));
  }
  for (const dir of dirs) {
    copyPath(path.join(ROOT, dir), path.join(extensionDir, dir));
  }

  fs.writeFileSync(
    path.join(extensionDir, 'manifest.json'),
    `${JSON.stringify(benchManifest(port), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(extensionDir, 'bench-bridge.html'),
    '<!doctype html><meta charset="utf-8"><title>PII Shield Bench Bridge</title>\n'
  );

  return extensionDir;
}

function benchPageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>PII Shield Gemini Long Paste Bench</title>
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 32px;
      color: #17202a;
      background: #f7f9fb;
    }
    main {
      display: grid;
      gap: 20px;
      max-width: 960px;
    }
    textarea,
    [contenteditable="true"] {
      min-height: 180px;
      padding: 12px;
      border: 1px solid #ccd6dd;
      border-radius: 6px;
      background: #fff;
      font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <main>
    <h1>PII Shield Gemini Long Paste Bench</h1>
    <textarea id="bench-textarea" spellcheck="false"></textarea>
    <div id="bench-contenteditable" contenteditable="true" role="textbox" aria-label="Contenteditable editor"></div>
  </main>
</body>
</html>`;
}

function startBenchServer(port = 0) {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url?.startsWith('/bench')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(benchPageHtml());
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        url: `http://127.0.0.1:${address.port}/bench`,
      });
    });
  });
}

async function sendRuntimeMessage(bridgePage, message) {
  return bridgePage.evaluate((payload) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(response);
    });
  }), message);
}

function readOutputText(result) {
  return String(result?.outputText ?? result?.anonymizedText ?? '');
}

function summarizeTransformResult(result) {
  return {
    hasPII: Boolean(result?.hasPII),
    analysisStatus: result?.analysisStatus || 'unknown',
    fallbackReason: result?.fallbackReason || null,
    error: result?.error || null,
    displaySummary: result?.displaySummary || null,
    replacementCount: result?.replacements ? Object.keys(result.replacements).length : 0,
    durationMs: result?.durationMs ?? null,
    chunkCount: result?.chunkCount ?? null,
    charLimit: result?.charLimit ?? null,
    measureContextUsageCount: result?.measureContextUsageCount ?? 0,
    quotaRetryCount: result?.quotaRetryCount ?? 0,
    timeoutCount: result?.timeoutCount ?? 0,
    contextWindow: result?.contextWindow ?? null,
    contextUsage: result?.contextUsage ?? null,
    inputQuota: result?.inputQuota ?? null,
    promptOverheadTokens: result?.promptOverheadTokens ?? null,
  };
}

function evaluateQuality(testCase, outputText) {
  const originalStillPresent = testCase.expected
    .filter((entry) => outputText.includes(entry.value))
    .map((entry) => entry.type);
  const protectedTypes = testCase.expected
    .filter((entry) => !outputText.includes(entry.value))
    .map((entry) => entry.type);

  return {
    expectedPiiCount: testCase.expected.length,
    originalPiiRemoved: originalStillPresent.length === 0,
    protectedTypes,
    originalStillPresentTypes: originalStillPresent,
    safeTextUnchanged: testCase.expected.length === 0 ? outputText === testCase.text : null,
  };
}

function baseRecord(runId, testCase, measurement, repetition, extra = {}) {
  return {
    runId,
    timestamp: new Date().toISOString(),
    measurement,
    repetition,
    caseId: testCase.id,
    sizeLabel: testCase.sizeLabel,
    targetChars: testCase.targetChars,
    actualChars: testCase.text.length,
    variant: testCase.variant,
    inputSha256: sha256(testCase.text),
    expectedTypes: [...new Set(testCase.expected.map((entry) => entry.type))],
    ...extra,
  };
}

function appendJsonl(file, record) {
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

async function clearAllMappings(bridgePage) {
  await sendRuntimeMessage(bridgePage, { type: 'CLEAR_ALL_MAPPINGS' });
}

async function measureBackground(bridgePage, runId, testCase, repetition, discarded = false) {
  await clearAllMappings(bridgePage);
  const startedAt = Date.now();
  const result = await sendRuntimeMessage(bridgePage, {
    type: 'BENCH_ANALYZE_TEXT',
    text: testCase.text,
  });
  const roundtripMs = Date.now() - startedAt;
  const outputText = readOutputText(result);

  return baseRecord(runId, testCase, 'background', repetition, {
    discarded,
    roundtripMs,
    quality: evaluateQuality(testCase, outputText),
    result: summarizeTransformResult(result),
  });
}

async function clearEditor(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    document.getElementById('pii-shield-banner')?.remove();
    if (!el) return;

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      el.value = '';
      el.focus();
      el.setSelectionRange(0, 0);
      return;
    }

    el.textContent = '';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
}

async function readEditorText(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return '';
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return el.value;
    }
    return el.textContent || el.innerText || '';
  }, selector);
}

async function dispatchSyntheticPaste(page, selector, text) {
  return page.evaluate(({ sel, pasteText }) => {
    const el = document.querySelector(sel) || document.body;
    el.focus();
    window.__piiShieldBenchPasteStart = performance.now();
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', pasteText);
    el.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true,
    }));
    return window.__piiShieldBenchPasteStart;
  }, { sel: selector, pasteText: text });
}

async function waitForPasteSettled(page, selector, timeoutMs) {
  await page.waitForFunction((sel) => {
    const editor = document.querySelector(sel);
    const status = document.getElementById('pii-shield-paste-status');
    const banner = document.getElementById('pii-shield-banner');
    const statusVisible = Boolean(status?.classList.contains('pii-shield-paste-status-visible'));
    const bannerVisible = Boolean(banner?.classList.contains('pii-shield-banner-visible'));
    let text = '';

    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      text = editor.value;
    } else if (editor) {
      text = editor.textContent || editor.innerText || '';
    }

    return !statusVisible && (text.length > 0 || bannerVisible);
  }, selector, { timeout: timeoutMs });
}

async function measurePaste(page, bridgePage, runId, testCase, repetition, editor, discarded = false) {
  await clearAllMappings(bridgePage);
  await clearEditor(page, editor.selector);
  const startInPage = await dispatchSyntheticPaste(page, editor.selector, testCase.text);
  await waitForPasteSettled(page, editor.selector, 90_000);
  const endInPage = await page.evaluate(() => performance.now());
  const outputText = await readEditorText(page, editor.selector);

  return baseRecord(runId, testCase, `paste:${editor.name}`, repetition, {
    discarded,
    roundtripMs: endInPage - startInPage,
    quality: evaluateQuality(testCase, outputText),
  });
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function formatMs(value) {
  return value === null || value === undefined ? 'n/a' : `${Math.round(value)} ms`;
}

function groupKey(record) {
  return `${record.measurement}||${record.sizeLabel}||${record.variant}`;
}

function aggregateLatency(records) {
  const groups = new Map();
  for (const record of records.filter((item) => !item.discarded && item.phase !== 'preflight')) {
    const key = groupKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  return [...groups.entries()].map(([key, rows]) => {
    const [measurement, sizeLabel, variant] = key.split('||');
    const latencies = rows.map((row) => row.roundtripMs).filter(Number.isFinite);
    const partialCount = rows.filter((row) => row.result?.analysisStatus === 'partial').length;
    const timeoutCount = rows.filter((row) => (row.result?.timeoutCount || 0) > 0
      || row.result?.fallbackReason === 'timeout').length;
    const quotaRetryCount = rows.filter((row) => (row.result?.quotaRetryCount || 0) > 0).length;

    return {
      measurement,
      sizeLabel,
      variant,
      runs: rows.length,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.length ? Math.max(...latencies) : null,
      completeRate: rows.length ? (rows.length - partialCount) / rows.length : null,
      timeoutRate: rows.length ? timeoutCount / rows.length : null,
      quotaRetryRate: rows.length ? quotaRetryCount / rows.length : null,
    };
  }).sort((a, b) => (
    a.measurement.localeCompare(b.measurement)
    || Number.parseInt(a.sizeLabel, 10) - Number.parseInt(b.sizeLabel, 10)
    || a.variant.localeCompare(b.variant)
  ));
}

function aggregateCoverage(records) {
  const totals = new Map();
  for (const record of records.filter((item) => !item.discarded && item.quality)) {
    for (const type of record.expectedTypes || []) {
      const entry = totals.get(type) || { expected: 0, protected: 0 };
      entry.expected += 1;
      if (record.quality.protectedTypes?.includes(type)) entry.protected += 1;
      totals.set(type, entry);
    }
  }

  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function recommend(records, runtimeInfo) {
  const measured = records.filter((item) => !item.discarded && item.measurement === 'background');
  const hasQuotaRetries = measured.some((row) => (row.result?.quotaRetryCount || 0) > 0);
  const hasTimeouts = measured.some((row) => (row.result?.timeoutCount || 0) > 0
    || row.result?.fallbackReason === 'timeout');
  const hasBudgetPartials = measured.some((row) => row.result?.fallbackReason === 'analysis_budget_exceeded');
  const largestComplete = measured
    .filter((row) => row.result?.analysisStatus === 'complete')
    .map((row) => row.targetChars)
    .sort((a, b) => b - a)[0] || null;
  const charLimits = measured
    .map((row) => row.result?.charLimit)
    .filter(Number.isFinite);
  const avgCharLimit = charLimits.length
    ? Math.round(charLimits.reduce((sum, value) => sum + value, 0) / charLimits.length)
    : null;
  const p95Background = percentile(
    measured.map((row) => row.roundtripMs).filter(Number.isFinite),
    95
  );
  const current = runtimeInfo?.longPaste || {};

  const threshold = hasTimeouts || hasBudgetPartials
    ? Math.min(current.longTextThresholdChars || 4000, 4000)
    : current.longTextThresholdChars || 4000;
  const chunkBudget = hasQuotaRetries && avgCharLimit
    ? Math.max(1200, Math.floor(avgCharLimit * 0.8))
    : avgCharLimit || 'keep current estimate';
  const timeout = p95Background
    ? Math.max(current.aiChunkTimeoutMs || 5000, Math.ceil((p95Background / 2) / 500) * 500)
    : current.aiChunkTimeoutMs || 5000;
  const longBudget = p95Background
    ? Math.max(current.longPasteAnalysisBudgetMs || 11000, Math.ceil((p95Background * 1.25) / 500) * 500)
    : current.longPasteAnalysisBudgetMs || 11000;

  return {
    longTextThresholdChars: threshold,
    chunkBudgetChars: chunkBudget,
    aiChunkTimeoutMs: timeout,
    longPasteAnalysisBudgetMs: longBudget,
    notes: [
      largestComplete ? `largest complete background case: ${largestComplete} chars` : 'no complete background cases recorded',
      hasQuotaRetries ? 'quota retries observed; reduce chunk budget before raising timeouts' : 'no quota retries observed',
      hasTimeouts || hasBudgetPartials ? 'partial or timeout results observed; validate timeout budget against p95' : 'no timeout partials observed',
    ],
  };
}

function renderSummary({ runId, records, preflight = {}, runtimeInfo = null, dryRun = false }) {
  const latencyRows = aggregateLatency(records);
  const coverageRows = aggregateCoverage(records);
  const rec = recommend(records, runtimeInfo);
  const completeRows = records.filter((item) => !item.discarded && item.quality);
  const completeCount = completeRows.filter((row) => row.result?.analysisStatus !== 'partial').length;
  const partialCount = completeRows.length - completeCount;

  const lines = [];
  lines.push(`# Gemini Long Paste Benchmark ${runId}`);
  lines.push('');
  lines.push(`Mode: ${dryRun ? 'dry-run smoke data' : 'real Chrome Prompt API run'}`);
  lines.push(`Chrome: ${preflight.chromeVersion || 'n/a'}`);
  lines.push(`User agent: ${preflight.userAgent || 'n/a'}`);
  lines.push(`OS: ${preflight.os || `${os.platform()} ${os.release()} ${os.arch()}`}`);
  lines.push(`Extension version: ${runtimeInfo?.manifestVersion || 'n/a'}`);
  lines.push('');
  lines.push('## Latency');
  lines.push('');
  lines.push('| Measurement | Size | Variant | Runs | p50 | p95 | Max | Complete | Timeout | Quota retry |');
  lines.push('|---|---:|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of latencyRows) {
    lines.push([
      row.measurement,
      row.sizeLabel,
      row.variant,
      row.runs,
      formatMs(row.p50),
      formatMs(row.p95),
      formatMs(row.max),
      row.completeRate === null ? 'n/a' : `${Math.round(row.completeRate * 100)}%`,
      row.timeoutRate === null ? 'n/a' : `${Math.round(row.timeoutRate * 100)}%`,
      row.quotaRetryRate === null ? 'n/a' : `${Math.round(row.quotaRetryRate * 100)}%`,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  lines.push('## Complete vs Partial');
  lines.push('');
  lines.push(`Complete: ${completeCount}`);
  lines.push(`Partial: ${partialCount}`);
  lines.push('');
  lines.push('## Detection Coverage');
  lines.push('');
  lines.push('| PII type | Protected | Expected | Coverage |');
  lines.push('|---|---:|---:|---:|');
  for (const [type, value] of coverageRows) {
    const rate = value.expected ? Math.round((value.protected / value.expected) * 100) : 0;
    lines.push(`| ${type} | ${value.protected} | ${value.expected} | ${rate}% |`);
  }
  lines.push('');
  lines.push('## Recommendations');
  lines.push('');
  lines.push(`- LONG_TEXT_THRESHOLD_CHARS: ${rec.longTextThresholdChars}`);
  lines.push(`- Chunk budget chars: ${rec.chunkBudgetChars}`);
  lines.push(`- AI_CHUNK_TIMEOUT_MS: ${rec.aiChunkTimeoutMs}`);
  lines.push(`- LONG_PASTE_ANALYSIS_BUDGET_MS: ${rec.longPasteAnalysisBudgetMs}`);
  for (const note of rec.notes) lines.push(`- ${note}`);
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function simulatedResultFor(runId, testCase, measurement) {
  const outputText = testCase.expected.reduce(
    (text, entry) => text.split(entry.value).join(`<${entry.type.toUpperCase()}>`),
    testCase.text
  );
  const sizeFactor = testCase.targetChars / 1000;
  return baseRecord(runId, testCase, measurement, 1, {
    discarded: false,
    roundtripMs: Math.round((measurement === 'background' ? 70 : 110) + sizeFactor * 15),
    quality: evaluateQuality(testCase, outputText),
    result: {
      hasPII: testCase.expected.length > 0,
      analysisStatus: 'complete',
      fallbackReason: null,
      replacementCount: testCase.expected.length,
      durationMs: Math.round(50 + sizeFactor * 12),
      chunkCount: Math.max(1, Math.ceil(testCase.targetChars / 8000)),
      charLimit: testCase.targetChars >= 4000 ? 8000 : null,
      measureContextUsageCount: testCase.targetChars >= 4000 ? 1 : 0,
      quotaRetryCount: 0,
      timeoutCount: 0,
    },
  });
}

async function runDryRun(options) {
  const runId = `gemini-long-paste-${timestampForFile()}-dry-run`;
  const corpus = generateCorpus(options);
  validateCorpus(corpus);
  const records = [];

  ensureDir(RESULTS_ROOT);
  const jsonlPath = path.join(RESULTS_ROOT, `${runId}.jsonl`);
  const mdPath = path.join(RESULTS_ROOT, `${runId}.md`);
  fs.rmSync(jsonlPath, { force: true });
  fs.rmSync(mdPath, { force: true });

  for (const testCase of corpus) {
    for (const measurement of ['background', 'paste:textarea', 'paste:contenteditable']) {
      const record = simulatedResultFor(runId, testCase, measurement);
      records.push(record);
      appendJsonl(jsonlPath, record);
    }
  }

  fs.writeFileSync(mdPath, renderSummary({ runId, records, dryRun: true }));
  console.log(`Dry-run corpus cases: ${corpus.length}`);
  console.log(`JSONL: ${jsonlPath}`);
  console.log(`Summary: ${mdPath}`);
}

async function runBenchmark(options) {
  const runId = `gemini-long-paste-${timestampForFile()}`;
  const corpus = generateCorpus(options);
  validateCorpus(corpus);
  const records = [];
  const editors = [
    { name: 'textarea', selector: '#bench-textarea' },
    { name: 'contenteditable', selector: '#bench-contenteditable' },
  ];
  let serverHandle = null;
  let context = null;

  ensureDir(RESULTS_ROOT);
  const jsonlPath = path.join(RESULTS_ROOT, `${runId}.jsonl`);
  const mdPath = path.join(RESULTS_ROOT, `${runId}.md`);
  fs.rmSync(jsonlPath, { force: true });
  fs.rmSync(mdPath, { force: true });

  try {
    serverHandle = await startBenchServer(options.port);
    const extensionDir = buildBenchExtension(serverHandle.port);
    const profileDir = process.env.PII_SHIELD_BENCH_PROFILE
      || path.join(os.homedir(), '.pii-shield-bench-profile');
    ensureDir(profileDir);

    const launchOptions = {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    };
    if (process.env.PII_SHIELD_CHROME_PATH) {
      launchOptions.executablePath = process.env.PII_SHIELD_CHROME_PATH;
    } else {
      launchOptions.channel = 'chrome';
    }

    context = await chromium.launchPersistentContext(profileDir, launchOptions);
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];
    const bridgePage = await context.newPage();
    await bridgePage.goto(`chrome-extension://${extensionId}/bench-bridge.html`);

    const chromeVersion = context.browser()?.version() || null;
    const userAgent = await bridgePage.evaluate(() => navigator.userAgent);
    const preflight = {
      phase: 'preflight',
      runId,
      timestamp: new Date().toISOString(),
      chromeVersion,
      userAgent,
      os: `${os.platform()} ${os.release()} ${os.arch()}`,
      profileDir,
      extensionDir,
    };

    await sendRuntimeMessage(bridgePage, { type: 'SET_ENABLED', enabled: true });
    await sendRuntimeMessage(bridgePage, { type: 'SET_MODE', mode: 'reversible' });
    const aiStatus = await sendRuntimeMessage(bridgePage, { type: 'GET_AI_STATUS' });
    const runtimeInfoBeforeWarmup = await sendRuntimeMessage(bridgePage, { type: 'BENCH_GET_RUNTIME_INFO' });
    appendJsonl(jsonlPath, {
      ...preflight,
      event: 'runtime-info-before-warmup',
      aiStatus,
      runtimeInfo: runtimeInfoBeforeWarmup,
    });

    if (aiStatus?.availability !== 'available') {
      throw new Error(`${SETUP_HINTS}\n\nGET_AI_STATUS response:\n${JSON.stringify(aiStatus, null, 2)}`);
    }

    const ensureStartedAt = Date.now();
    const ensureStatus = await sendRuntimeMessage(bridgePage, { type: 'ENSURE_AI_READY' });
    const ensureDurationMs = Date.now() - ensureStartedAt;
    if (ensureStatus?.availability !== 'available' && !ensureStatus?.ready) {
      throw new Error(`${SETUP_HINTS}\n\nENSURE_AI_READY response:\n${JSON.stringify(ensureStatus, null, 2)}`);
    }

    const warmupCase = buildCase('warmup', 1200, 'prose-pii');
    const warmupStartedAt = Date.now();
    const warmupResult = await sendRuntimeMessage(bridgePage, {
      type: 'BENCH_ANALYZE_TEXT',
      text: warmupCase.text,
    });
    const warmupDurationMs = Date.now() - warmupStartedAt;
    if (warmupResult?.error) {
      throw new Error(`Warmup analysis failed: ${JSON.stringify(summarizeTransformResult(warmupResult), null, 2)}`);
    }

    const runtimeInfo = await sendRuntimeMessage(bridgePage, { type: 'BENCH_GET_RUNTIME_INFO' });

    appendJsonl(jsonlPath, {
      ...preflight,
      event: 'warmup',
      ensureDurationMs,
      ensureStatus,
      warmupDurationMs,
      warmupResult: summarizeTransformResult(warmupResult),
      runtimeInfo,
    });

    const page = await context.newPage();
    await page.goto(serverHandle.url);
    await page.locator('#pii-shield-badge').waitFor({ timeout: 10_000 });

    const firstCaseBySize = new Map();
    for (const testCase of corpus) {
      if (!firstCaseBySize.has(testCase.sizeLabel)) firstCaseBySize.set(testCase.sizeLabel, testCase);
    }

    for (const warmup of firstCaseBySize.values()) {
      const backgroundWarmup = await measureBackground(bridgePage, runId, warmup, 0, true);
      records.push(backgroundWarmup);
      appendJsonl(jsonlPath, backgroundWarmup);
      for (const editor of editors) {
        const pasteWarmup = await measurePaste(page, bridgePage, runId, warmup, 0, editor, true);
        records.push(pasteWarmup);
        appendJsonl(jsonlPath, pasteWarmup);
      }
    }

    for (const testCase of corpus) {
      for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
        const backgroundRecord = await measureBackground(bridgePage, runId, testCase, repetition);
        records.push(backgroundRecord);
        appendJsonl(jsonlPath, backgroundRecord);

        for (const editor of editors) {
          const pasteRecord = await measurePaste(page, bridgePage, runId, testCase, repetition, editor);
          records.push(pasteRecord);
          appendJsonl(jsonlPath, pasteRecord);
        }
      }
    }

    fs.writeFileSync(mdPath, renderSummary({
      runId,
      records,
      preflight,
      runtimeInfo,
    }));

    console.log(`Benchmark complete.`);
    console.log(`JSONL: ${jsonlPath}`);
    console.log(`Summary: ${mdPath}`);
  } finally {
    if (context) await context.close();
    if (serverHandle) {
      await new Promise((resolve) => serverHandle.server.close(resolve));
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.dryRun) {
    await runDryRun(options);
    return;
  }

  await runBenchmark(options);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
