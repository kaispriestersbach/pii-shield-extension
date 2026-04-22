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

  // Quick regex prefilter — when any of these match, we always scan the paste
  // even if it's shorter than the default length threshold.
  const PII_QUICK_PATTERNS = [
    /[\w.+-]+@[\w-]+\.[\w.-]+/,              // email
    /(?:\+?\d[\s\-\/.()]*){7,}/,              // phone-ish (7+ digits with separators)
    /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/,       // IBAN
    /\b(?:\d[ -]?){13,19}\b/,                 // credit card
  ];

  function shouldScanPaste(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.length >= 10) return true;
    return PII_QUICK_PATTERNS.some(re => re.test(trimmed));
  }

  function errorMessageFor(code) {
    switch (code) {
      case 'ai_unavailable': return 'Gemini Nano ist nicht verfügbar.';
      case 'parse_failed':   return 'Die KI-Antwort konnte nicht ausgewertet werden.';
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

  function showNotification(message, type = 'info', replacements = null) {
    const banner = createNotificationBanner();

    let html = `
      <div class="pii-shield-banner-content">
        <div class="pii-shield-banner-icon">
          ${type === 'anonymized' ? '🛡️' : type === 'deanonymized' ? '🔓' : 'ℹ️'}
        </div>
        <div class="pii-shield-banner-text">
          <strong>PII Shield</strong>
          <span>${message}</span>
        </div>`;

    if (replacements && Object.keys(replacements).length > 0) {
      html += `
        <button class="pii-shield-banner-toggle" id="pii-shield-toggle-details">
          Details ▼
        </button>`;
    }

    html += `
        <button class="pii-shield-banner-close" id="pii-shield-close">✕</button>
      </div>`;

    if (replacements && Object.keys(replacements).length > 0) {
      html += `
        <div class="pii-shield-banner-details" id="pii-shield-details" style="display:none;">
          <table class="pii-shield-table">
            <thead>
              <tr><th>Original</th><th>→</th><th>Ersetzt durch</th></tr>
            </thead>
            <tbody>
              ${Object.entries(replacements).map(([orig, fake]) =>
                `<tr>
                  <td class="pii-shield-original">${escapeHtml(orig)}</td>
                  <td>→</td>
                  <td class="pii-shield-fake">${escapeHtml(fake)}</td>
                </tr>`
              ).join('')}
            </tbody>
          </table>
        </div>`;
    }

    banner.innerHTML = html;
    banner.className = `pii-shield-banner pii-shield-banner-${type} pii-shield-banner-visible`;

    // Event listeners
    const closeBtn = document.getElementById('pii-shield-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        banner.className = 'pii-shield-banner';
      });
    }

    const toggleBtn = document.getElementById('pii-shield-toggle-details');
    const details = document.getElementById('pii-shield-details');
    if (toggleBtn && details) {
      toggleBtn.addEventListener('click', () => {
        const isVisible = details.style.display !== 'none';
        details.style.display = isVisible ? 'none' : 'block';
        toggleBtn.textContent = isVisible ? 'Details ▼' : 'Details ▲';
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
    runPasteWorker();
  }, true); // Capture phase — intercept before the page's own handlers

  async function runPasteWorker() {
    if (pasteWorkerRunning) return;
    pasteWorkerRunning = true;
    try {
      while (pasteQueue.length > 0) {
        const { text, target } = pasteQueue.shift();
        await processOnePaste(text, target);
      }
    } finally {
      pasteWorkerRunning = false;
    }
  }

  async function processOnePaste(text, target) {
    try {
      const result = await sendMessage({ type: 'ANONYMIZE_TEXT', text });

      if (result && result.error) {
        // Analysis failed — ask user before leaking potentially sensitive text.
        // Default (Abbrechen) = do NOT insert the original text.
        const proceed = window.confirm(
          `PII Shield: ${errorMessageFor(result.error)}\n\n` +
          `Originaltext trotzdem einfügen?\n\n` +
          `Abbrechen wird empfohlen, falls der Text personenbezogene Daten enthält.`
        );
        if (proceed) {
          insertTextAtTarget(target, text);
        } else {
          showNotification('Einfügen abgebrochen — PII-Analyse fehlgeschlagen.', 'info');
        }
      } else if (result && result.hasPII) {
        insertTextAtTarget(target, result.anonymizedText);
        showNotification(
          `${Object.keys(result.replacements).length} PII-Element(e) erkannt und anonymisiert.`,
          'anonymized',
          result.replacements
        );
      } else {
        insertTextAtTarget(target, text);
      }
    } catch (err) {
      console.error('[PII Shield] Error processing paste:', err);
      const proceed = window.confirm(
        `PII Shield: Kommunikation mit dem Service Worker fehlgeschlagen.\n\n` +
        `Originaltext trotzdem einfügen?`
      );
      if (proceed) insertTextAtTarget(target, text);
    }
  }

  // ─── Copy Interception (De-Anonymization) ─────────────────────────────────

  document.addEventListener('copy', async (event) => {
    if (!isEnabled || copyProcessing) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString();
    if (!selectedText || selectedText.trim().length < 5) return;

    copyProcessing = true;

    try {
      const result = await sendMessage({
        type: 'DEANONYMIZE_TEXT',
        text: selectedText
      });

      if (result && result.deanonymizedText !== selectedText) {
        event.preventDefault();
        event.clipboardData.setData('text/plain', result.deanonymizedText);

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

    // Handle contenteditable elements (used by ChatGPT, Claude, etc.)
    if (activeElement.isContentEditable || activeElement.getAttribute('contenteditable') === 'true') {
      // Use execCommand for contenteditable (best compatibility with React/Vue apps)
      document.execCommand('insertText', false, text);
      // Dispatch input event for frameworks
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // Handle textarea and input elements
    if (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT') {
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;
      const before = activeElement.value.substring(0, start);
      const after = activeElement.value.substring(end);
      activeElement.value = before + text + after;
      activeElement.selectionStart = activeElement.selectionEnd = start + text.length;
      // Dispatch events for React/Vue
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
      activeElement.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // Fallback: try to find the nearest editable element
    const editableEl = findEditableElement();
    if (editableEl) {
      editableEl.focus();
      document.execCommand('insertText', false, text);
      editableEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
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
    });
  } else {
    updateBadge();
  }

  console.log('[PII Shield] Content script loaded on', window.location.hostname);
})();
