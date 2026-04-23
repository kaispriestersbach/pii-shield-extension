/**
 * PII Shield – Content Script
 * 
 * Intercepts paste events to anonymize PII before it reaches the AI chatbot.
 * Intercepts copy events to de-anonymize PII in chatbot responses.
 * Shows a visual notification banner when PII is detected and replaced.
 */

(() => {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────

  let isEnabled = true;
  let notificationTimeout = null;

  // Serialized paste processor. Events are queued so a second Ctrl+V arriving
  // during an ongoing analysis is handled in order instead of being dropped.
  const pasteQueue = [];
  let pasteWorkerRunning = false;
  // Guards the copy interceptor from re-entering itself when we rewrite clipboard.
  let copyProcessing = false;
  const localMappings = new Map();
  let localMappingsTouchedAt = 0;

  // Quick regex prefilter — when any of these match, we always scan the paste
  // even if it's shorter than the default length threshold.
  const PII_QUICK_PATTERNS = [
    /[\w.+-]+@[\w-]+\.[\w.-]+/,              // email
    /(?:\+?\d[\s\-\/.()]*){7,}/,              // phone-ish (7+ digits with separators)
    /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/,       // IBAN
    /\b(?:\d[ -]?){13,19}\b/,                 // credit card
  ];

  const WORD_LIKE = /^[\p{L}\p{N}\s\-]+$/u;
  const NAME_PART = /^[\p{L}\-]+$/u;
  const REGEX_META = /[.*+?^${}()|[\]\\]/g;
  const LOCAL_MAPPING_TTL_MS = 30 * 60 * 1000;

  function shouldScanPaste(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.length >= 10) return true;
    return PII_QUICK_PATTERNS.some(re => re.test(trimmed));
  }

  function errorMessageFor(code) {
    switch (code) {
      case 'ai_api_missing': return 'Die Chrome Prompt API ist in diesem Erweiterungskontext nicht verfügbar.';
      case 'ai_unavailable': return 'Gemini Nano ist nicht verfügbar.';
      case 'ai_status_failed': return 'Der Gemini-Nano-Status konnte nicht geprüft werden.';
      case 'ai_session_failed': return 'Gemini Nano konnte nicht gestartet oder heruntergeladen werden.';
      case 'parse_failed':   return 'Die KI-Antwort konnte nicht ausgewertet werden.';
      case 'timeout': return 'Die PII-Analyse hat zu lange gedauert.';
      case 'detection_failed': return 'Die PII-Analyse ist fehlgeschlagen.';
      default: return 'Unbekannter Fehler bei der PII-Analyse.';
    }
  }

  // Load initial state
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response) isEnabled = response.enabled;
  });

  // Listen for enable/disable changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.piiShieldEnabled) {
      isEnabled = changes.piiShieldEnabled.newValue;
      updateBadge();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'PII_MAPPINGS_UPDATED') {
      replaceLocalMappings(message.mappings || {});
    }
  });

  // ─── Notification Banner ──────────────────────────────────────────────────

  function createNotificationBanner() {
    let banner = document.getElementById('pii-shield-banner');
    if (banner) return banner;

    banner = document.createElement('div');
    banner.id = 'pii-shield-banner';
    banner.className = 'pii-shield-banner';
    document.body.appendChild(banner);
    return banner;
  }

  function showNotification(message, type = 'info') {
    const banner = createNotificationBanner();

    const confidenceHint = type === 'anonymized'
      ? '<span class="pii-shield-banner-hint">Lokal anonymisiert — Details nur im Extension-Popup.</span>'
      : '';

    const icon = type === 'anonymized' ? '🛡️' : type === 'deanonymized' ? '🔓' : 'ℹ️';

    const html = `
      <div class="pii-shield-banner-content">
        <div class="pii-shield-banner-icon">
          ${icon}
        </div>
        <div class="pii-shield-banner-text">
          <strong>PII Shield</strong>
          <span>${escapeHtml(message)}</span>
          ${confidenceHint}
        </div>
        <button class="pii-shield-banner-close" id="pii-shield-close">✕</button>
      </div>`;

    banner.innerHTML = html;
    banner.className = `pii-shield-banner pii-shield-banner-${type} pii-shield-banner-visible`;

    // Event listeners
    const closeBtn = document.getElementById('pii-shield-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        banner.className = 'pii-shield-banner';
      });
    }

    // Auto-hide after 8 seconds
    if (notificationTimeout) clearTimeout(notificationTimeout);
    notificationTimeout = setTimeout(() => {
      banner.className = 'pii-shield-banner';
    }, 8000);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function createPasteStatusIndicator() {
    let indicator = document.getElementById('pii-shield-paste-status');
    if (indicator) return indicator;

    indicator = document.createElement('div');
    indicator.id = 'pii-shield-paste-status';
    indicator.className = 'pii-shield-paste-status';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    document.body.appendChild(indicator);
    return indicator;
  }

  function updatePasteStatusIndicator() {
    const totalPending = pasteQueue.length + (pasteWorkerRunning ? 1 : 0);
    const badge = document.getElementById('pii-shield-badge');
    if (badge) {
      badge.classList.toggle('pii-shield-badge-busy', totalPending > 0);
    }

    const indicator = document.getElementById('pii-shield-paste-status')
      || (totalPending > 0 ? createPasteStatusIndicator() : null);
    if (!indicator) return;

    if (totalPending === 0) {
      indicator.className = 'pii-shield-paste-status';
      indicator.innerHTML = '';
      return;
    }

    const queuedBehindCurrent = pasteWorkerRunning ? pasteQueue.length : Math.max(pasteQueue.length - 1, 0);
    const detail = pasteWorkerRunning
      ? queuedBehindCurrent > 0
        ? `Der aktuelle Text wird lokal geprüft. ${queuedBehindCurrent} weiterer Einfügevorgang wartet bereits.`
        : 'Der Text wird lokal geprüft und danach automatisch eingefügt.'
      : 'Die lokale Prüfung startet sofort.';

    const countBadge = totalPending > 1
      ? `<span class="pii-shield-paste-status-count">${totalPending}</span>`
      : '';

    indicator.innerHTML = `
      <div class="pii-shield-paste-status-content">
        <span class="pii-shield-paste-status-spinner" aria-hidden="true"></span>
        <div class="pii-shield-paste-status-text">
          <strong>PII Shield prüft das Einfügen…</strong>
          <span>${escapeHtml(detail)}</span>
        </div>
        ${countBadge}
      </div>`;
    indicator.className = 'pii-shield-paste-status pii-shield-paste-status-visible';
  }

  // ─── Status Badge ─────────────────────────────────────────────────────────

  function updateBadge() {
    let badge = document.getElementById('pii-shield-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'pii-shield-badge';
      badge.className = 'pii-shield-badge';
      badge.title = 'PII Shield – Click to toggle';
      badge.textContent = '🛡️';
      badge.addEventListener('click', toggleEnabled);
      document.body.appendChild(badge);
    }
    badge.classList.toggle('pii-shield-badge-disabled', !isEnabled);
    badge.classList.toggle('pii-shield-badge-busy', pasteQueue.length + (pasteWorkerRunning ? 1 : 0) > 0);
    badge.title = isEnabled ? 'PII Shield aktiv – Klicken zum Deaktivieren' : 'PII Shield inaktiv – Klicken zum Aktivieren';
  }

  function toggleEnabled() {
    isEnabled = !isEnabled;
    chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: isEnabled });
    updateBadge();
    showNotification(
      isEnabled ? 'PII Shield wurde aktiviert.' : 'PII Shield wurde deaktiviert.',
      'info'
    );
  }

  // ─── Paste Interception (Anonymization) ───────────────────────────────────

  document.addEventListener('paste', (event) => {
    if (!isEnabled) return;

    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const text = clipboardData.getData('text/plain');
    if (!text || !shouldScanPaste(text)) return;

    // Capture the paste target now — by the time the queue processes it the
    // user may have focused elsewhere.
    const target = document.activeElement;

    event.preventDefault();
    event.stopImmediatePropagation();

    pasteQueue.push({ text, target });
    updatePasteStatusIndicator();
    runPasteWorker();
  }, true); // Capture phase — intercept before the page's own handlers

  async function runPasteWorker() {
    if (pasteWorkerRunning) return;
    pasteWorkerRunning = true;
    updatePasteStatusIndicator();
    try {
      while (pasteQueue.length > 0) {
        const { text, target } = pasteQueue.shift();
        updatePasteStatusIndicator();
        await processOnePaste(text, target);
      }
    } finally {
      pasteWorkerRunning = false;
      updatePasteStatusIndicator();
    }
  }

  async function processOnePaste(text, target) {
    try {
      const result = await sendMessage({ type: 'ANONYMIZE_TEXT', text });

      if (result && result.error) {
        showNotification(`Einfügen blockiert: ${errorMessageFor(result.error)}`, 'info');
      } else if (result && result.hasPII) {
        const replacements = result.replacements || {};
        insertTextAtTarget(target, result.anonymizedText);
        addReplacementsToLocalMappings(replacements);
        showNotification(
          `${Object.keys(replacements).length} PII-Element(e) erkannt und anonymisiert.`,
          'anonymized'
        );
      } else if (result) {
        insertTextAtTarget(target, text);
      } else {
        showNotification('Einfügen blockiert: Keine Antwort vom Service Worker.', 'info');
      }
    } catch (err) {
      console.error('[PII Shield] Error processing paste:', err);
      showNotification('Einfügen blockiert: Service Worker nicht erreichbar.', 'info');
    }
  }

  // ─── Copy Interception (De-Anonymization) ─────────────────────────────────

  document.addEventListener('copy', (event) => {
    if (!isEnabled || copyProcessing) return;
    pruneLocalMappingsIfExpired();
    if (!event.clipboardData || localMappings.size === 0) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString();
    if (!selectedText || selectedText.trim().length < 5) return;

    copyProcessing = true;

    try {
      const deanonymizedText = deanonymizeWithLocalMappings(selectedText);

      if (deanonymizedText !== selectedText) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.clipboardData.setData('text/plain', deanonymizedText);

        showNotification(
          'Anonymisierte Daten in der Antwort wurden wiederhergestellt.',
          'deanonymized'
        );
      }
    } catch (err) {
      console.error('[PII Shield] Error processing copy:', err);
    } finally {
      copyProcessing = false;
    }
  }, true);

  // ─── Local Mapping Mirror (Synchronous Copy Path) ─────────────────────────

  function replaceLocalMappings(mappings) {
    localMappings.clear();
    for (const [fake, original] of Object.entries(mappings)) {
      if (fake && original) {
        localMappings.set(fake, original);
      }
    }
    localMappingsTouchedAt = localMappings.size > 0 ? Date.now() : 0;
  }

  function addReplacementsToLocalMappings(replacements) {
    for (const [original, fake] of Object.entries(replacements)) {
      if (fake && original) {
        localMappings.set(fake, original);
      }
    }
    if (localMappings.size > 0) {
      localMappingsTouchedAt = Date.now();
    }
  }

  function pruneLocalMappingsIfExpired() {
    if (!localMappingsTouchedAt) return;
    if (Date.now() - localMappingsTouchedAt <= LOCAL_MAPPING_TTL_MS) return;
    localMappings.clear();
    localMappingsTouchedAt = 0;
  }

  async function refreshLocalMappings() {
    try {
      const response = await sendMessage({ type: 'GET_MAPPINGS' });
      replaceLocalMappings(response?.mappings || {});
    } catch (err) {
      console.warn('[PII Shield] Could not refresh local mappings:', err);
      localMappings.clear();
    }
  }

  function deanonymizeWithLocalMappings(text) {
    return applyLocalReplacements(text, buildLocalReplacementEntries(localMappings));
  }

  function buildLocalReplacementEntries(map) {
    const entries = [];
    for (const [from, to] of map) {
      if (!from || !to) continue;
      entries.push({ from, to });

      const fromParts = from.split(/\s+/);
      const toParts = to.split(/\s+/);
      if (fromParts.length === toParts.length && fromParts.length >= 2) {
        for (let i = 0; i < fromParts.length; i++) {
          if (fromParts[i].length >= 3 && toParts[i].length >= 2 &&
              NAME_PART.test(fromParts[i]) && NAME_PART.test(toParts[i])) {
            entries.push({ from: fromParts[i], to: toParts[i] });
          }
        }
      }
    }
    entries.sort((a, b) => b.from.length - a.from.length);
    return entries;
  }

  function applyLocalReplacements(text, entries) {
    const spans = findLocalReplacementSpans(text, entries);
    let result = text;
    for (let i = spans.length - 1; i >= 0; i--) {
      const span = spans[i];
      result = result.slice(0, span.start) + span.replacement + result.slice(span.end);
    }
    return result;
  }

  function findLocalReplacementSpans(text, entries) {
    const candidates = [];

    entries.forEach(({ from, to }, entryIndex) => {
      if (!from || !to) return;

      if (WORD_LIKE.test(from)) {
        const escaped = from.replace(REGEX_META, '\\$&');
        const re = new RegExp(
          `(?<=^|[^\\p{L}\\p{N}_])${escaped}(\\p{L}{0,2})(?=$|[^\\p{L}\\p{N}_])`,
          'gu'
        );
        for (const match of text.matchAll(re)) {
          candidates.push({
            start: match.index,
            end: match.index + match[0].length,
            replacement: to + (match[1] || ''),
            priority: entryIndex,
          });
        }
        return;
      }

      let start = text.indexOf(from);
      while (start !== -1) {
        candidates.push({
          start,
          end: start + from.length,
          replacement: to,
          priority: entryIndex,
        });
        start = text.indexOf(from, start + Math.max(from.length, 1));
      }
    });

    candidates.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      const lengthDiff = (b.end - b.start) - (a.end - a.start);
      if (lengthDiff !== 0) return lengthDiff;
      return a.priority - b.priority;
    });

    const selected = [];
    let lastEnd = -1;
    for (const candidate of candidates) {
      if (candidate.start < lastEnd) continue;
      selected.push(candidate);
      lastEnd = candidate.end;
    }

    return selected;
  }

  // ─── Helper: Insert Text at Cursor ────────────────────────────────────────

  function insertTextAtTarget(preferredTarget, text) {
    // Prefer the element that was focused when the paste event fired, but fall
    // back to the currently focused element if the target is gone (e.g., user
    // navigated away during the 1–5s analysis).
    let activeElement = preferredTarget && document.contains(preferredTarget)
      ? preferredTarget
      : document.activeElement;

    if (!activeElement) activeElement = findEditableElement();
    if (!activeElement) return;
    if (activeElement !== document.activeElement) {
      try { activeElement.focus(); } catch (_) {}
    }

    if (activeElement.isContentEditable || activeElement.getAttribute('contenteditable') === 'true') {
      insertIntoContentEditable(activeElement, text);
      return;
    }

    if (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT') {
      insertIntoInput(activeElement, text);
      return;
    }

    const editableEl = findEditableElement();
    if (editableEl) {
      try { editableEl.focus(); } catch (_) {}
      if (editableEl.tagName === 'TEXTAREA' || editableEl.tagName === 'INPUT') {
        insertIntoInput(editableEl, text);
      } else {
        insertIntoContentEditable(editableEl, text);
      }
    }
  }

  // Insert into a plain <input> or <textarea>. Uses the native value setter so
  // frameworks like React (which cache the descriptor) still see the change,
  // then fires an InputEvent with inputType so beforeinput-aware editors react.
  function insertIntoInput(el, text) {
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);

    if (nativeSetter) {
      nativeSetter.call(el, next);
    } else {
      el.value = next;
    }
    const caret = start + text.length;
    try { el.setSelectionRange(caret, caret); } catch (_) {}

    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertFromPaste',
        data: text,
      }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Insert into a contenteditable host. We first give the framework a chance to
  // handle a synthetic beforeinput (ProseMirror/Lexical hook into it); if the
  // event is not canceled we fall back to execCommand, which Chromium still
  // supports and which correctly integrates with undo history.
  function insertIntoContentEditable(el, text) {
    let handled = false;
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromPaste',
        data: text,
        dataTransfer: dt,
      });
      handled = !el.dispatchEvent(beforeInput);
    } catch (_) { /* older browsers */ }

    if (!handled) {
      // eslint-disable-next-line deprecation/deprecation
      document.execCommand('insertText', false, text);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function findEditableElement() {
    // Common selectors for AI chatbot input fields
    const selectors = [
      '[contenteditable="true"]',
      'textarea',
      '#prompt-textarea',                         // ChatGPT
      '.ProseMirror',                              // Claude
      'div[data-placeholder]',                     // Various
      'rich-textarea',                             // Gemini
      '.ql-editor',                                // Quill-based editors
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  // ─── Helper: Promise-based message sending ────────────────────────────────

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // ─── Initialize ───────────────────────────────────────────────────────────

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      updateBadge();
      refreshLocalMappings();
    });
  } else {
    updateBadge();
    refreshLocalMappings();
  }

  setInterval(pruneLocalMappingsIfExpired, 60 * 1000);

  console.log('[PII Shield] Content script loaded on', window.location.hostname);
})();
