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
  let isProcessing = false;
  let notificationTimeout = null;

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

  document.addEventListener('paste', async (event) => {
    if (!isEnabled || isProcessing) return;

    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const text = clipboardData.getData('text/plain');
    if (!text || text.trim().length < 10) return; // Skip very short texts

    // Prevent default paste while we process
    event.preventDefault();
    event.stopImmediatePropagation();
    isProcessing = true;

    try {
      // Send text to background for PII analysis
      const result = await sendMessage({
        type: 'ANONYMIZE_TEXT',
        text: text
      });

      if (result && result.hasPII) {
        // Insert anonymized text
        insertTextAtCursor(result.anonymizedText);

        showNotification(
          `${Object.keys(result.replacements).length} PII-Element(e) erkannt und anonymisiert.`,
          'anonymized',
          result.replacements
        );
      } else {
        // No PII found – insert original text
        insertTextAtCursor(text);
      }
    } catch (err) {
      console.error('[PII Shield] Error processing paste:', err);
      // On error, insert original text
      insertTextAtCursor(text);
    } finally {
      isProcessing = false;
    }
  }, true); // Use capture phase to intercept before the page's own handlers

  // ─── Copy Interception (De-Anonymization) ─────────────────────────────────

  document.addEventListener('copy', async (event) => {
    if (!isEnabled || isProcessing) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString();
    if (!selectedText || selectedText.trim().length < 5) return;

    isProcessing = true;

    try {
      const result = await sendMessage({
        type: 'DEANONYMIZE_TEXT',
        text: selectedText
      });

      if (result && result.deanonymizedText !== selectedText) {
        // The text was de-anonymized – override clipboard
        event.preventDefault();
        event.clipboardData.setData('text/plain', result.deanonymizedText);

        showNotification(
          'Anonymisierte Daten in der Antwort wurden wiederhergestellt.',
          'deanonymized'
        );
      }
      // If no changes, let the default copy proceed
    } catch (err) {
      console.error('[PII Shield] Error processing copy:', err);
      // On error, let default copy proceed
    } finally {
      isProcessing = false;
    }
  }, true);

  // ─── Helper: Insert Text at Cursor ────────────────────────────────────────

  function insertTextAtCursor(text) {
    const activeElement = document.activeElement;

    if (!activeElement) return;

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
