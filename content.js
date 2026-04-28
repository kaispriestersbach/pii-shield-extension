/**
 * PII Shield – Content Script
 *
 * Reversible mode anonymizes with fake-but-plausible values and restores
 * answers on copy. Simple mode masks with typed placeholders and never
 * restores on copy.
 */

(() => {
  'use strict';

  const { t } = globalThis.PIIShieldI18n || { t: (key) => key };

  let isEnabled = true;
  let currentMode = 'reversible';
  let simpleModeModelState = null;
  let notificationTimeout = null;
  let copyProcessing = false;
  let clipboardWriteInProgress = false;
  let lastCopyIntentAt = 0;
  let pasteWorkerRunning = false;

  const pasteQueue = [];
  const localMappings = new Map();
  let localMappingsTouchedAt = 0;
  let pendingPartialRemask = null;

  const PII_QUICK_PATTERNS = [
    /[\w.+-]+@[\w-]+\.[\w.-]+/,
    /(?:\+?\d[\s\-/.()]*){7,}/,
    /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/,
    /\b(?:\d[ -]?){13,19}\b/,
  ];

  const WORD_LIKE = /^[\p{L}\p{N}\s\-]+$/u;
  const NAME_PART = /^[\p{L}\-]+$/u;
  const REGEX_META = /[.*+?^${}()|[\]\\]/g;
  const LOCAL_MAPPING_TTL_MS = 30 * 60 * 1000;
  const SIMPLE_REMASK_READY_TIMEOUT_MS = 3500;
  const CLIPBOARD_WRITE_RETRY_DELAYS_MS = [0, 80, 240];
  const CLIPBOARD_BRIDGE_SOURCE = 'pii-shield-clipboard-bridge';
  const CLIPBOARD_BRIDGE_WRITE_REQUEST = 'PII_SHIELD_CLIPBOARD_WRITE_REQUEST';
  const CLIPBOARD_BRIDGE_WRITE_RESPONSE = 'PII_SHIELD_CLIPBOARD_WRITE_RESPONSE';
  const CLIPBOARD_WRITE_INTENT_WINDOW_MS = 2000;
  const COPY_CONTROL_RE = /\b(copy|clipboard|kopieren|copiar|copier|copia|copie)\b|antwort\s+kopieren|copy\s+(response|answer)/i;

  function shouldScanPaste(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.length >= 10) return true;
    return PII_QUICK_PATTERNS.some((re) => re.test(trimmed));
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function errorMessageFor(code) {
    switch (code) {
      case 'ai_api_missing': return t('errorAiApiMissing');
      case 'ai_unavailable': return t('errorAiUnavailable');
      case 'ai_status_failed': return t('errorAiStatusFailed');
      case 'ai_session_failed': return t('errorAiSessionFailed');
      case 'parse_failed': return t('errorParseFailed');
      case 'timeout': return t('errorTimeout');
      case 'detection_failed': return t('errorDetectionFailed');
      default: return t('errorUnknownDetection');
    }
  }

  function manualDecisionMessageFor(code) {
    switch (code) {
      case 'simple_model_missing':
        return t('manualSimpleModelMissing');
      case 'simple_model_permission_missing':
        return t('manualSimplePermissionMissing');
      case 'simple_model_downloading':
        return t('manualSimpleDownloading');
      case 'simple_model_download_failed':
        return t('manualSimpleDownloadFailed');
      case 'simple_model_cache_quota_exceeded':
        return t('manualSimpleQuotaExceeded');
      case 'webgpu_unavailable':
        return t('manualWebGPUUnavailable');
      case 'offscreen_unavailable':
        return t('manualOffscreenUnavailable');
      case 'simple_model_init_failed':
        return t('manualSimpleInitFailed');
      case 'simple_analysis_failed':
        return t('manualSimpleAnalysisFailed');
      case 'simple_model_unavailable':
        return t('manualSimpleUnavailable');
      default:
        return t('manualSimpleDefault');
    }
  }

  function badgeTitle() {
    if (!isEnabled) return t('badgeInactive');
    return currentMode === 'simple'
      ? t('badgeActiveSimple')
      : t('badgeActiveReversible');
  }

  function applyStatusResponse(response) {
    if (!response) return;
    if (typeof response.enabled === 'boolean') {
      isEnabled = response.enabled;
    }
    if (response.mode === 'simple' || response.mode === 'reversible') {
      currentMode = response.mode;
      if (currentMode !== 'reversible') {
        replaceLocalMappings({});
      }
    }
    if (response.simpleModeModelState) {
      simpleModeModelState = response.simpleModeModelState;
    }
    updateBadge();
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.piiShieldEnabled) {
      isEnabled = changes.piiShieldEnabled.newValue;
    }
    if (changes.piiShieldMode) {
      currentMode = changes.piiShieldMode.newValue === 'simple' ? 'simple' : 'reversible';
      if (currentMode !== 'reversible') {
        replaceLocalMappings({});
      }
    }
    updateBadge();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'PII_MAPPINGS_UPDATED') {
      replaceLocalMappings(message.mappings || {});
    }
  });

  // ─── Banner / Overlay UI ─────────────────────────────────────────────────

  function createNotificationBanner() {
    let banner = document.getElementById('pii-shield-banner');
    if (banner) return banner;

    banner = document.createElement('div');
    banner.id = 'pii-shield-banner';
    banner.className = 'pii-shield-banner';
    document.body.appendChild(banner);
    return banner;
  }

  function showNotification(message, type = 'info', options = {}) {
    if (type !== 'partial') {
      clearPendingPartialRemask();
    }

    const banner = createNotificationBanner();
    let dismissed = false;

    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      banner.className = 'pii-shield-banner';
      if (typeof options.onDismiss === 'function') {
        options.onDismiss();
      }
    };

    let hint = '';
    if (options.hint) {
      hint = `<span class="pii-shield-banner-hint">${escapeHtml(options.hint)}</span>`;
    } else if (type === 'anonymized') {
      hint = `<span class="pii-shield-banner-hint">${escapeHtml(t('bannerHintAnonymized'))}</span>`;
    } else if (type === 'masked') {
      hint = `<span class="pii-shield-banner-hint">${escapeHtml(t('bannerHintMasked'))}</span>`;
    }

    const icon = type === 'deanonymized'
      ? '🔓'
      : type === 'masked'
        ? '🧼'
        : type === 'anonymized'
          ? '🛡️'
          : type === 'partial'
            ? '⚠️'
            : 'ℹ️';

    const action = options.actionLabel
      ? `<button type="button" class="pii-shield-banner-action" id="pii-shield-action">${escapeHtml(options.actionLabel)}</button>`
      : '';

    banner.innerHTML = `
      <div class="pii-shield-banner-content">
        <div class="pii-shield-banner-icon">${icon}</div>
        <div class="pii-shield-banner-text">
          <strong>PII Shield</strong>
          <span>${escapeHtml(message)}</span>
          ${hint}
        </div>
        ${action}
        <button class="pii-shield-banner-close" id="pii-shield-close">✕</button>
      </div>`;
    banner.className = `pii-shield-banner pii-shield-banner-${type} pii-shield-banner-visible`;

    const actionButton = document.getElementById('pii-shield-action');
    if (actionButton && typeof options.onAction === 'function') {
      actionButton.addEventListener('click', (event) => {
        event.preventDefault();
        void options.onAction();
      });
    }

    const closeButton = document.getElementById('pii-shield-close');
    if (closeButton) {
      closeButton.addEventListener('click', dismiss);
    }

    if (notificationTimeout) clearTimeout(notificationTimeout);
    notificationTimeout = setTimeout(dismiss, options.autoHideMs || 8000);
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
        ? t(queuedBehindCurrent === 1 ? 'pasteQueuedDetail' : 'pasteQueuedDetailPlural', [queuedBehindCurrent])
        : t('pasteRunningDetail')
      : t('pasteStartsDetail');
    const countBadge = totalPending > 1
      ? `<span class="pii-shield-paste-status-count">${totalPending}</span>`
      : '';

    indicator.innerHTML = `
      <div class="pii-shield-paste-status-content">
        <span class="pii-shield-paste-status-spinner" aria-hidden="true"></span>
        <div class="pii-shield-paste-status-text">
          <strong>${escapeHtml(t('pasteStatusTitle'))}</strong>
          <span>${escapeHtml(detail)}</span>
        </div>
        ${countBadge}
      </div>`;
    indicator.className = 'pii-shield-paste-status pii-shield-paste-status-visible';
  }

  function showManualDecisionDialog(reasonCode) {
    return new Promise((resolve) => {
      const existing = document.getElementById('pii-shield-decision-backdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'pii-shield-decision-backdrop';
      backdrop.className = 'pii-shield-decision-backdrop';
      backdrop.innerHTML = `
        <div class="pii-shield-decision-card" role="dialog" aria-modal="true" aria-labelledby="pii-shield-decision-title">
          <h2 id="pii-shield-decision-title">${escapeHtml(t('manualDialogTitle'))}</h2>
          <p>${escapeHtml(manualDecisionMessageFor(reasonCode))}</p>
          <div class="pii-shield-decision-actions">
            <button type="button" class="pii-shield-decision-btn pii-shield-decision-cancel" data-action="cancel">${escapeHtml(t('manualCancel'))}</button>
            <button type="button" class="pii-shield-decision-btn pii-shield-decision-insert" data-action="insert">${escapeHtml(t('manualInsert'))}</button>
          </div>
        </div>`;

      const finish = (decision) => {
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.remove();
        resolve(decision);
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish('cancel');
        }
      };

      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) {
          finish('cancel');
        }
      });

      backdrop.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
          finish(button.getAttribute('data-action'));
        });
      });

      document.addEventListener('keydown', onKeyDown, true);
      document.body.appendChild(backdrop);
    });
  }

  // ─── Badge / Status ──────────────────────────────────────────────────────

  function updateBadge() {
    let badge = document.getElementById('pii-shield-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'pii-shield-badge';
      badge.className = 'pii-shield-badge';
      badge.textContent = '🛡️';
      badge.addEventListener('click', toggleEnabled);
      document.body.appendChild(badge);
    }

    badge.classList.toggle('pii-shield-badge-disabled', !isEnabled);
    badge.classList.toggle('pii-shield-badge-busy', pasteQueue.length + (pasteWorkerRunning ? 1 : 0) > 0);
    badge.title = badgeTitle();
  }

  async function refreshStatus() {
    try {
      applyStatusResponse(await sendMessage({ type: 'GET_STATUS' }));
    } catch (error) {
      console.warn('[PII Shield] Could not refresh status:', error);
      updateBadge();
    }
  }

  async function toggleEnabled() {
    isEnabled = !isEnabled;
    updateBadge();

    try {
      applyStatusResponse(await sendMessage({ type: 'SET_ENABLED', enabled: isEnabled }));
    } catch (error) {
      console.error('[PII Shield] Could not toggle enabled state:', error);
    }

    showNotification(
      isEnabled ? t('notifyEnabled') : t('notifyDisabled'),
      'info'
    );
  }

  // ─── Paste Flow ──────────────────────────────────────────────────────────

  document.addEventListener('paste', (event) => {
    if (!isEnabled) return;

    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const text = clipboardData.getData('text/plain');
    if (!text || !shouldScanPaste(text)) return;

    const target = document.activeElement;

    event.preventDefault();
    event.stopImmediatePropagation();

    clearPendingPartialRemask();
    pasteQueue.push({ text, target });
    updatePasteStatusIndicator();
    void runPasteWorker();
  }, true);

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

      if (result?.requiresManualDecision) {
        const decision = await showManualDecisionDialog(result.manualDecisionReason);
        if (decision === 'insert') {
          insertTextAtTarget(target, text);
          showNotification(t('notifyOriginalInserted'), 'info');
        } else {
          showNotification(t('notifyPasteCanceled'), 'info');
        }
        return;
      }

      if (result?.error) {
        showNotification(t('notifyPasteBlocked', [errorMessageFor(result.error)]), 'info');
        return;
      }

      if (result?.analysisStatus === 'partial') {
        const outputText = result.outputText || result.anonymizedText || text;
        const insertion = insertTextAtTarget(target, outputText);
        applyMappingsFromPasteResult(result);
        showPartialPasteNotification(result, {
          originalText: text,
          insertedText: outputText,
          insertion,
        });
        return;
      }

      if (result?.hasPII) {
        const outputText = result.outputText || result.anonymizedText || text;
        insertTextAtTarget(target, outputText);

        applyMappingsFromPasteResult(result);

        const count = result.displaySummary?.count
          ?? Object.keys(result.replacements || {}).length
          ?? 0;
        const transformed = result.transformType === 'masked' ? t('transformMasked') : t('transformAnonymized');

        showNotification(
          t('notifyPiiTransformed', [count, transformed]),
          result.transformType === 'masked' ? 'masked' : 'anonymized'
        );
        return;
      }

      if (result) {
        insertTextAtTarget(target, text);
        return;
      }

      showNotification(t('notifyNoServiceWorkerResponse'), 'info');
    } catch (error) {
      console.error('[PII Shield] Error processing paste:', error);
      showNotification(t('notifyServiceWorkerUnreachable'), 'info');
    }
  }

  function applyMappingsFromPasteResult(result) {
    if (result.mode === 'reversible') {
      addReplacementsToLocalMappings(result.replacements || {});
    } else {
      replaceLocalMappings({});
    }
  }

  function showPartialPasteNotification(result, remaskContext = null) {
    const count = result.displaySummary?.count
      ?? Object.keys(result.replacements || {}).length
      ?? 0;
    const remaskRequest = remaskContext?.insertion
      ? {
        originalText: remaskContext.originalText,
        insertedText: remaskContext.insertedText,
        insertion: remaskContext.insertion,
      }
      : null;

    pendingPartialRemask = remaskRequest;

    showNotification(
      t('notifyPartialPaste', [count]),
      'partial',
      {
        hint: t('notifyPartialPasteHint'),
        actionLabel: t('partialSimpleModeCta'),
        autoHideMs: 14000,
        onAction: () => {
          void prepareSimpleModeFromBanner(remaskRequest);
        },
        onDismiss: () => {
          clearPendingPartialRemask(remaskRequest);
        },
      }
    );
  }

  function clearPendingPartialRemask(expected = null) {
    if (!expected || pendingPartialRemask === expected) {
      pendingPartialRemask = null;
    }
  }

  async function prepareSimpleModeFromBanner(remaskRequest = null) {
    const activeRemask = remaskRequest && pendingPartialRemask === remaskRequest
      ? remaskRequest
      : null;
    clearPendingPartialRemask(activeRemask);

    try {
      const status = currentMode === 'simple'
        ? await sendMessage({ type: 'ENSURE_SIMPLE_MODEL_READY' })
        : await sendMessage({ type: 'SET_MODE', mode: 'simple' });

      applyStatusResponse(status);

      let modelState = status?.simpleModeModelState || status || {};

      if (status?.error === 'simple_model_permission_missing'
        || modelState.lastError === 'simple_model_permission_missing'
        || modelState.downloadState === 'permission_missing') {
        showNotification(t('notifySimpleModeNeedsPopup'), 'info');
        return;
      }

      modelState = await waitForSimpleModelReady(modelState, SIMPLE_REMASK_READY_TIMEOUT_MS);

      if (modelState?.ready && activeRemask) {
        const remasked = await remaskCurrentPasteWithSimpleMode(activeRemask);
        if (remasked) {
          showNotification(t('notifyPartialPasteRemasked'), 'masked');
          return;
        }

        showNotification(t('notifyPartialPasteRemaskUnavailable'), 'info');
        return;
      }

      if (status?.mode === 'simple' || currentMode === 'simple') {
        showNotification(
          modelState?.ready ? t('notifySimpleModeEnabled') : t('notifySimpleModePreparing'),
          'info'
        );
        return;
      }

      showNotification(t('notifySimpleModePreparing'), 'info');
    } catch (error) {
      console.warn('[PII Shield] Could not prepare Simple Mode from banner:', error);
      showNotification(t('notifySimpleModeNeedsPopup'), 'info');
    }
  }

  async function waitForSimpleModelReady(initialState, timeoutMs) {
    let modelState = initialState || {};
    if (modelState.ready) return modelState;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await delay(250);
      try {
        const status = await sendMessage({ type: 'GET_SIMPLE_MODEL_STATUS' });
        modelState = status?.simpleModeModelState || status || {};
        applyStatusResponse({ simpleModeModelState: modelState });
        if (modelState.ready || modelState.downloadState === 'permission_missing') {
          return modelState;
        }
      } catch {
        return modelState;
      }
    }

    return modelState;
  }

  async function remaskCurrentPasteWithSimpleMode(remaskRequest) {
    if (!remaskRequest?.originalText || !remaskRequest?.insertion) return false;

    const result = await sendMessage({
      type: 'MASK_TEXT_SIMPLE',
      text: remaskRequest.originalText,
    });

    if (result?.requiresManualDecision || result?.error) return false;

    const maskedText = result?.outputText || result?.anonymizedText;
    if (typeof maskedText !== 'string' || maskedText === remaskRequest.originalText) return false;
    if (!replaceInsertedPaste(remaskRequest, maskedText)) return false;

    applyMappingsFromPasteResult({
      mode: 'simple',
      replacements: {},
    });
    return true;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Copy Flow ───────────────────────────────────────────────────────────

  document.addEventListener('click', (event) => {
    if (isLikelyCopyControlEvent(event)) {
      markCopyIntent();
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!isCopyShortcut(event)) return;
    markCopyIntent();

    if (!isEnabled || currentMode !== 'reversible' || clipboardWriteInProgress) return;

    const result = deanonymizeCopyText(getSelectedCopyText());
    if (!result.changed) return;

    scheduleClipboardRewrite(result.text);
  }, true);

  document.addEventListener('copy', (event) => {
    if (!isEnabled || copyProcessing || currentMode !== 'reversible' || clipboardWriteInProgress) return;

    const result = deanonymizeCopyText(getSelectedCopyText());
    if (!result.changed) return;

    copyProcessing = true;

    try {
      if (event.clipboardData) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.clipboardData.setData('text/plain', result.text);
        showDeanonymizedNotification();
      } else {
        scheduleClipboardRewrite(result.text);
      }
    } catch (error) {
      console.error('[PII Shield] Error processing copy:', error);
    } finally {
      copyProcessing = false;
    }
  }, true);

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data
      || data.source !== CLIPBOARD_BRIDGE_SOURCE
      || data.type !== CLIPBOARD_BRIDGE_WRITE_REQUEST
      || typeof data.id !== 'string') {
      return;
    }

    void handleClipboardBridgeWriteRequest(data);
  });

  function markCopyIntent() {
    lastCopyIntentAt = Date.now();
  }

  function hasRecentCopyIntent() {
    return Date.now() - lastCopyIntentAt <= CLIPBOARD_WRITE_INTENT_WINDOW_MS;
  }

  function isCopyShortcut(event) {
    if (event.defaultPrevented || event.isComposing) return false;
    if (event.altKey) return false;

    const key = String(event.key || '').toLowerCase();
    if (key === 'c' && (event.ctrlKey || event.metaKey)) return true;
    return key === 'insert' && event.ctrlKey && !event.metaKey;
  }

  function isLikelyCopyControlEvent(event) {
    if (!event.isTrusted) return false;
    const control = findLikelyControl(event.target);
    if (!control) return false;

    const descriptor = [
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
      control.getAttribute('data-testid'),
      control.getAttribute('data-test-id'),
      control.getAttribute('data-clipboard-action'),
      control.textContent,
    ].filter(Boolean).join(' ');

    return COPY_CONTROL_RE.test(descriptor);
  }

  function findLikelyControl(target) {
    if (!(target instanceof Element)) return null;
    const control = target.closest('button, [role="button"], [aria-label], [title], [data-testid], [data-test-id]');
    if (!control || !document.contains(control)) return null;
    if (control.closest('#pii-shield-banner, #pii-shield-badge, #pii-shield-decision-backdrop')) return null;
    return control;
  }

  function getSelectedCopyText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return '';
    return selection.toString();
  }

  function deanonymizeCopyText(text) {
    const originalText = String(text || '');
    if (!originalText || originalText.trim().length < 5) {
      return { text: originalText, changed: false };
    }

    pruneLocalMappingsIfExpired();
    if (localMappings.size === 0) {
      return { text: originalText, changed: false };
    }

    const deanonymizedText = deanonymizeWithLocalMappings(originalText);
    return {
      text: deanonymizedText,
      changed: deanonymizedText !== originalText,
    };
  }

  async function handleClipboardBridgeWriteRequest(data) {
    let handled = false;

    try {
      if (isEnabled && currentMode === 'reversible' && hasRecentCopyIntent()) {
        const result = deanonymizeCopyText(data.text);
        if (result.changed) {
          handled = await writeTextToClipboard(result.text, { allowFallback: false });
          if (handled) showDeanonymizedNotification();
        }
      }
    } catch (error) {
      console.error('[PII Shield] Error processing clipboard write:', error);
    } finally {
      window.postMessage({
        source: CLIPBOARD_BRIDGE_SOURCE,
        type: CLIPBOARD_BRIDGE_WRITE_RESPONSE,
        id: data.id,
        handled,
      }, '*');
    }
  }

  function scheduleClipboardRewrite(text) {
    let notified = false;

    for (const [index, delay] of CLIPBOARD_WRITE_RETRY_DELAYS_MS.entries()) {
      setTimeout(() => {
        void writeTextToClipboard(text, { allowFallback: index === 0 }).then((success) => {
          if (success && !notified) {
            notified = true;
            showDeanonymizedNotification();
          }
        });
      }, delay);
    }
  }

  async function writeTextToClipboard(text, options = {}) {
    if (!text) return false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      console.warn('[PII Shield] Clipboard API write failed:', error);
    }

    if (options.allowFallback) {
      return fallbackCopyText(text);
    }
    return false;
  }

  function fallbackCopyText(text) {
    if (clipboardWriteInProgress) return false;

    const activeElement = document.activeElement;
    const selection = window.getSelection();
    const ranges = [];

    if (selection) {
      for (let index = 0; index < selection.rangeCount; index++) {
        ranges.push(selection.getRangeAt(index).cloneRange());
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.left = '-1000px';
    textarea.style.opacity = '0';

    let copied = false;
    const onCopy = (event) => {
      if (!event.clipboardData) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.clipboardData.setData('text/plain', text);
      copied = true;
    };

    clipboardWriteInProgress = true;
    document.body.appendChild(textarea);
    document.addEventListener('copy', onCopy, true);

    try {
      textarea.focus();
      textarea.select();
      // eslint-disable-next-line deprecation/deprecation
      copied = document.execCommand('copy') || copied;
    } catch (error) {
      console.warn('[PII Shield] Fallback clipboard write failed:', error);
    } finally {
      document.removeEventListener('copy', onCopy, true);
      textarea.remove();
      clipboardWriteInProgress = false;

      if (selection) {
        selection.removeAllRanges();
        for (const range of ranges) {
          selection.addRange(range);
        }
      }

      if (activeElement && typeof activeElement.focus === 'function') {
        try { activeElement.focus(); } catch {}
      }
    }

    return copied;
  }

  function showDeanonymizedNotification() {
    showNotification(t('notifyDeanonymized'), 'deanonymized');
  }

  // ─── Local Mapping Mirror ────────────────────────────────────────────────

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
    if (currentMode !== 'reversible') {
      replaceLocalMappings({});
      return;
    }

    try {
      const response = await sendMessage({ type: 'GET_MAPPINGS' });
      replaceLocalMappings(response?.mappings || {});
    } catch (error) {
      console.warn('[PII Shield] Could not refresh local mappings:', error);
      replaceLocalMappings({});
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
        for (let index = 0; index < fromParts.length; index++) {
          if (fromParts[index].length >= 3
            && toParts[index].length >= 2
            && NAME_PART.test(fromParts[index])
            && NAME_PART.test(toParts[index])) {
            entries.push({ from: fromParts[index], to: toParts[index] });
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

    for (let index = spans.length - 1; index >= 0; index--) {
      const span = spans[index];
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

  // ─── Editor Integration ─────────────────────────────────────────────────

  function insertTextAtTarget(preferredTarget, text) {
    let activeElement = preferredTarget && document.contains(preferredTarget)
      ? preferredTarget
      : document.activeElement;

    if (!activeElement) activeElement = findEditableElement();
    if (!activeElement) return null;

    if (activeElement !== document.activeElement) {
      try { activeElement.focus(); } catch {}
    }

    if (activeElement.isContentEditable || activeElement.getAttribute('contenteditable') === 'true') {
      return insertIntoContentEditable(activeElement, text);
    }

    if (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT') {
      return insertIntoInput(activeElement, text);
    }

    const editableEl = findEditableElement();
    if (!editableEl) return null;

    try { editableEl.focus(); } catch {}
    if (editableEl.tagName === 'TEXTAREA' || editableEl.tagName === 'INPUT') {
      return insertIntoInput(editableEl, text);
    }

    return insertIntoContentEditable(editableEl, text);
  }

  function insertIntoInput(el, text) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);

    setInputValue(el, next);

    const caret = start + text.length;
    try { el.setSelectionRange(caret, caret); } catch {}

    dispatchInputChange(el, text, 'insertFromPaste');

    return {
      kind: 'input',
      element: el,
      start,
      end: start + text.length,
      text,
    };
  }

  function replaceInsertedPaste(remaskRequest, replacementText) {
    const insertion = remaskRequest.insertion;
    if (!insertion?.element || !document.contains(insertion.element)) return false;

    if (insertion.kind === 'input') {
      return replaceInsertedInputText(insertion, remaskRequest.insertedText, replacementText);
    }

    if (insertion.kind === 'contenteditable') {
      return replaceUniqueContentEditableText(insertion.element, remaskRequest.insertedText, replacementText);
    }

    return false;
  }

  function replaceInsertedInputText(insertion, insertedText, replacementText) {
    const el = insertion.element;
    const currentValue = String(el.value || '');
    let start = insertion.start;
    let end = insertion.end;

    if (currentValue.slice(start, end) !== insertedText) {
      const first = currentValue.indexOf(insertedText);
      if (first === -1 || currentValue.indexOf(insertedText, first + insertedText.length) !== -1) {
        return false;
      }
      start = first;
      end = first + insertedText.length;
    }

    const next = currentValue.slice(0, start) + replacementText + currentValue.slice(end);
    setInputValue(el, next);
    const caret = start + replacementText.length;
    try { el.setSelectionRange(caret, caret); } catch {}
    dispatchInputChange(el, replacementText, 'insertReplacementText');
    return true;
  }

  function setInputValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
  }

  function dispatchInputChange(el, data, inputType) {
    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType,
        data,
      }));
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function insertIntoContentEditable(el, text) {
    let handled = false;

    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromPaste',
        data: text,
        dataTransfer,
      });
      handled = !el.dispatchEvent(beforeInput);
    } catch {}

    if (!handled) {
      // eslint-disable-next-line deprecation/deprecation
      document.execCommand('insertText', false, text);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));

    return {
      kind: 'contenteditable',
      element: el,
      text,
    };
  }

  function replaceUniqueContentEditableText(el, insertedText, replacementText) {
    const match = findUniqueTextNodeRange(el, insertedText);
    if (!match) return false;

    const range = document.createRange();
    range.setStart(match.startNode, match.startOffset);
    range.setEnd(match.endNode, match.endOffset);
    range.deleteContents();
    const replacementNode = document.createTextNode(replacementText);
    range.insertNode(replacementNode);

    const selection = window.getSelection();
    if (selection) {
      const after = document.createRange();
      after.setStartAfter(replacementNode);
      after.collapse(true);
      selection.removeAllRanges();
      selection.addRange(after);
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function findUniqueTextNodeRange(root, needle) {
    const target = String(needle || '');
    if (!target) return null;

    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let combined = '';
    let node;

    while ((node = walker.nextNode())) {
      const value = node.nodeValue || '';
      const start = combined.length;
      combined += value;
      nodes.push({
        node,
        start,
        end: combined.length,
      });
    }

    const matchStart = combined.indexOf(target);
    if (matchStart === -1 || combined.indexOf(target, matchStart + target.length) !== -1) {
      return null;
    }

    const start = textNodePosition(nodes, matchStart, false);
    const end = textNodePosition(nodes, matchStart + target.length, true);
    if (!start || !end) return null;

    return {
      startNode: start.node,
      startOffset: start.offset,
      endNode: end.node,
      endOffset: end.offset,
    };
  }

  function textNodePosition(nodes, offset, preferEnd) {
    if (nodes.length === 0) return null;

    for (const entry of nodes) {
      if (preferEnd && offset > entry.start && offset <= entry.end) {
        return { node: entry.node, offset: offset - entry.start };
      }
      if (!preferEnd && offset >= entry.start && offset < entry.end) {
        return { node: entry.node, offset: offset - entry.start };
      }
    }

    const last = nodes[nodes.length - 1];
    if (preferEnd && offset === last.end) {
      return { node: last.node, offset: (last.node.nodeValue || '').length };
    }

    return null;
  }

  function findEditableElement() {
    const selectors = [
      '[contenteditable="true"]',
      'textarea',
      '#prompt-textarea',
      '.ProseMirror',
      'div[data-placeholder]',
      'rich-textarea',
      '.ql-editor',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  // ─── Messaging / Init ───────────────────────────────────────────────────

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

  async function initialize() {
    updateBadge();
    await Promise.allSettled([
      refreshStatus(),
      refreshLocalMappings(),
    ]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void initialize();
    });
  } else {
    void initialize();
  }

  setInterval(pruneLocalMappingsIfExpired, 60 * 1000);

  console.log('[PII Shield] Content script loaded on', window.location.hostname);
})();
