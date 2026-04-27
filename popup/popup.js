/**
 * PII Shield – Popup Script
 *
 * Manages enable/disable, mode switching, model status cards and mappings.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const { t, setDocumentLanguage, localizeDocument } = globalThis.PIIShieldI18n;

  setDocumentLanguage();
  localizeDocument();

  const toggleEnabled = document.getElementById('toggle-enabled');
  const statusSection = document.getElementById('status-section');
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const statusSite = document.getElementById('status-site');
  const statusMode = document.getElementById('status-mode');
  const modeHint = document.getElementById('mode-hint');
  const modeSummary = document.getElementById('mode-summary');
  const footerVersion = document.getElementById('footer-version');

  const modeButtons = {
    reversible: document.getElementById('mode-reversible'),
    simple: document.getElementById('mode-simple'),
  };

  const aiStatusIcon = document.getElementById('ai-status-icon');
  const aiStatusValue = document.getElementById('ai-status-value');
  const aiStatusSection = document.getElementById('ai-status-section');
  const btnAIDownload = document.getElementById('btn-ai-download');

  const simpleStatusIcon = document.getElementById('simple-status-icon');
  const simpleStatusValue = document.getElementById('simple-status-value');
  const simpleStatusDetail = document.getElementById('simple-status-detail');
  const simpleStatusSection = document.getElementById('simple-status-section');
  const btnSimpleLoad = document.getElementById('btn-simple-load');

  const mappingsEmpty = document.getElementById('mappings-empty');
  const mappingsStaticHint = document.getElementById('mappings-static-hint');
  const mappingsTable = document.getElementById('mappings-table');
  const mappingsTbody = document.getElementById('mappings-tbody');
  const btnClear = document.getElementById('btn-clear');
  const btnClearAll = document.getElementById('btn-clear-all');

  let currentTabId = null;
  let currentMode = 'reversible';
  let aiStatusPoll = null;
  let simpleStatusPoll = null;
  const simpleModelOptionalDownloadOrigins = [
    'https://huggingface.co/*',
    'https://*.hf.co/*',
  ];

  footerVersion.textContent = `v${chrome.runtime.getManifest().version}`;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = String(tab.id);
      statusSite.textContent = new URL(tab.url || '').hostname;
    }
  } catch {
    statusSite.textContent = t('unknownSite');
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || {});
      });
    });
  }

  async function requestSimpleModelDownloadPermission() {
    if (!chrome.permissions?.request) return false;

    try {
      return await chrome.permissions.request({ origins: simpleModelOptionalDownloadOrigins });
    } catch {
      return false;
    }
  }

  function updateEnabledUI(enabled) {
    toggleEnabled.checked = enabled;

    if (enabled) {
      statusSection.classList.remove('disabled');
      statusText.textContent = t('statusActive');
      statusIndicator.querySelector('.popup-status-dot').style.background = '#3fb950';
      statusIndicator.querySelector('.popup-status-dot').style.boxShadow = '0 0 6px rgba(63, 185, 80, 0.4)';
    } else {
      statusSection.classList.add('disabled');
      statusText.textContent = t('statusDisabled');
      statusIndicator.querySelector('.popup-status-dot').style.background = '#8b949e';
      statusIndicator.querySelector('.popup-status-dot').style.boxShadow = 'none';
    }
  }

  function updateModeUI(mode) {
    currentMode = mode === 'simple' ? 'simple' : 'reversible';

    Object.entries(modeButtons).forEach(([key, button]) => {
      button.classList.toggle('popup-mode-btn-active', key === currentMode);
    });

    if (currentMode === 'simple') {
      statusMode.textContent = t('modeSimpleLabel');
      modeHint.textContent = t('modeHintSimple');
      modeSummary.textContent = t('modeSummarySimple');
      mappingsStaticHint.style.display = 'block';
      btnClear.disabled = true;
      btnClearAll.disabled = true;
    } else {
      statusMode.textContent = t('modeReversibleLabel');
      modeHint.textContent = t('modeHintReversible');
      modeSummary.textContent = t('modeSummaryReversible');
      mappingsStaticHint.style.display = 'none';
      btnClear.disabled = false;
      btnClearAll.disabled = false;
    }
  }

  function updateAIStatusUI(status) {
    const availability = typeof status === 'string' ? status : status?.availability;
    const phase = status?.phase || availability;
    const progress = status?.progress;

    btnAIDownload.hidden = true;
    btnAIDownload.disabled = false;
    btnAIDownload.textContent = t('modelLoad');

    if (phase === 'starting' || phase === 'creating') {
      aiStatusIcon.textContent = '⏳';
      aiStatusValue.textContent = phase === 'creating'
        ? t('aiSessionCreating')
        : t('aiDownloadStarting');
      aiStatusSection.className = 'popup-ai-status';
      btnAIDownload.hidden = false;
      btnAIDownload.disabled = true;
      btnAIDownload.textContent = t('loading');
      return;
    }

    switch (availability) {
      case 'available':
        aiStatusIcon.textContent = '✅';
        aiStatusValue.textContent = status?.ready
          ? t('ready')
          : phase === 'preparing'
            ? t('modelPreparing')
            : t('aiSessionCreating');
        aiStatusSection.className = 'popup-ai-status available';
        break;
      case 'downloading':
        aiStatusIcon.textContent = '⬇️';
        aiStatusValue.textContent = typeof progress === 'number'
          ? t('modelDownloadingProgress', [t('progressPercent', [Math.round(progress * 100)])])
          : t('modelDownloading');
        aiStatusSection.className = 'popup-ai-status';
        btnAIDownload.hidden = false;
        btnAIDownload.disabled = true;
        btnAIDownload.textContent = t('loading');
        break;
      case 'downloadable':
        aiStatusIcon.textContent = '📥';
        aiStatusValue.textContent = t('modelNotLoaded');
        aiStatusSection.className = 'popup-ai-status';
        btnAIDownload.hidden = false;
        break;
      case 'error':
        aiStatusIcon.textContent = '❌';
        aiStatusValue.textContent = status?.errorMessage
          ? t('errorWithMessage', [status.errorMessage])
          : t('statusCheckFailed');
        aiStatusSection.className = 'popup-ai-status unavailable';
        break;
      default:
        aiStatusIcon.textContent = '❌';
        aiStatusValue.textContent = status?.errorCode === 'ai_api_missing'
          ? t('promptApiUnavailable')
          : t('deviceUnavailable');
        aiStatusSection.className = 'popup-ai-status unavailable';
    }
  }

  function updateSimpleStatusUI(status) {
    simpleStatusSection.className = 'popup-ai-status';
    btnSimpleLoad.hidden = true;
    btnSimpleLoad.disabled = false;
    btnSimpleLoad.textContent = t('modelLoad');

    const downloadState = status?.downloadState || 'idle';
    const progress = Number.isFinite(status?.progress)
      ? Math.max(0, Math.min(1, status.progress))
      : null;
    const progressText = progress === null ? '' : t('progressPercent', [Math.round(progress * 100)]);

    if (downloadState === 'permission_missing' || status?.lastError === 'simple_model_permission_missing') {
      simpleStatusIcon.textContent = '🔐';
      simpleStatusValue.textContent = t('simplePermissionMissingValue');
      simpleStatusDetail.textContent = t('simplePermissionMissingDetail');
      simpleStatusSection.classList.add('unavailable');
      btnSimpleLoad.hidden = false;
      btnSimpleLoad.textContent = t('authorize');
      return;
    }

    if (status.loading || downloadState === 'downloading' || downloadState === 'loading') {
      simpleStatusIcon.textContent = downloadState === 'downloading' ? '⬇️' : '⏳';
      simpleStatusValue.textContent = downloadState === 'downloading'
        ? t('modelDownloadingProgress', [progressText])
        : t('simpleModelInitializing');
      simpleStatusDetail.textContent = status?.currentFile
        ? t('simpleCurrentFile', [status.currentFile])
        : t('simplePreparingWebGPU');
      btnSimpleLoad.hidden = false;
      btnSimpleLoad.disabled = true;
      btnSimpleLoad.textContent = t('loading');
      return;
    }

    if (status.ready) {
      simpleStatusIcon.textContent = '✅';
      simpleStatusValue.textContent = t('ready');
      simpleStatusDetail.textContent = t('simpleReadyDetail');
      simpleStatusSection.classList.add('available');
      return;
    }

    if (status.lastError) {
      simpleStatusIcon.textContent = '❌';
      simpleStatusValue.textContent = t('notReady');
      simpleStatusDetail.textContent = t('lastError', [status.lastError]);
      simpleStatusSection.classList.add('unavailable');
      btnSimpleLoad.hidden = false;
    } else {
      simpleStatusIcon.textContent = status?.cached ? '🧩' : '📥';
      simpleStatusValue.textContent = status?.cached ? t('cachedValue') : t('readyToDownload');
      simpleStatusDetail.textContent = status?.cached
        ? t('cachedDetail')
        : t('readyToDownloadDetail');
      btnSimpleLoad.hidden = false;
    }
  }

  async function refreshStatus() {
    const status = await sendRuntimeMessage({ type: 'GET_STATUS' });
    updateEnabledUI(status.enabled !== false);
    updateModeUI(status.mode || 'reversible');
    updateSimpleStatusUI(status.simpleModeModelState || {});
  }

  async function checkAIStatus() {
    updateAIStatusUI(await sendRuntimeMessage({ type: 'GET_AI_STATUS' }));
  }

  async function ensureAIReady() {
    updateAIStatusUI(await sendRuntimeMessage({ type: 'ENSURE_AI_READY' }));
    startAIPolling();
  }

  function startAIPolling() {
    if (aiStatusPoll) clearInterval(aiStatusPoll);
    aiStatusPoll = setInterval(async () => {
      const status = await sendRuntimeMessage({ type: 'GET_AI_STATUS' });
      updateAIStatusUI(status);
      if (status?.ready || status?.phase === 'unavailable' || status?.phase === 'error') {
        clearInterval(aiStatusPoll);
        aiStatusPoll = null;
      }
    }, 1000);
  }

  async function checkSimpleStatus() {
    updateSimpleStatusUI(await sendRuntimeMessage({ type: 'GET_SIMPLE_MODEL_STATUS' }));
  }

  async function ensureSimpleReady() {
    let status = await sendRuntimeMessage({ type: 'ENSURE_SIMPLE_MODEL_READY' });
    if (status?.lastError === 'simple_model_permission_missing') {
      const granted = await requestSimpleModelDownloadPermission();
      if (granted) {
        status = await sendRuntimeMessage({ type: 'ENSURE_SIMPLE_MODEL_READY' });
      }
    }

    updateSimpleStatusUI(status);
    startSimplePolling();
  }

  function isSimpleModelWorking(status) {
    return Boolean(status?.loading)
      || status?.downloadState === 'downloading'
      || status?.downloadState === 'loading';
  }

  function startSimplePolling() {
    if (simpleStatusPoll) clearInterval(simpleStatusPoll);
    simpleStatusPoll = setInterval(async () => {
      const status = await sendRuntimeMessage({ type: 'GET_SIMPLE_MODEL_STATUS' });
      updateSimpleStatusUI(status);
      if (status?.ready || (!isSimpleModelWorking(status) && status?.lastError)) {
        clearInterval(simpleStatusPoll);
        simpleStatusPoll = null;
      }
    }, 1000);
  }

  function showMappings(mappings) {
    mappingsEmpty.style.display = 'none';
    mappingsTable.style.display = 'table';
    mappingsStaticHint.style.display = 'none';
    mappingsTbody.innerHTML = '';

    for (const [fake, original] of Object.entries(mappings)) {
      const tr = document.createElement('tr');
      const tdFake = document.createElement('td');
      const tdOriginal = document.createElement('td');
      tdFake.textContent = fake;
      tdOriginal.textContent = original;
      tr.appendChild(tdFake);
      tr.appendChild(tdOriginal);
      mappingsTbody.appendChild(tr);
    }
  }

  function showEmptyMappings() {
    mappingsEmpty.style.display = currentMode === 'reversible' ? 'block' : 'none';
    mappingsTable.style.display = 'none';
    mappingsStaticHint.style.display = currentMode === 'simple' ? 'block' : 'none';
  }

  async function loadMappings() {
    if (!currentTabId || currentMode !== 'reversible') {
      showEmptyMappings();
      return;
    }

    const response = await sendRuntimeMessage({ type: 'GET_MAPPINGS', tabId: currentTabId });
    if (response?.mappings && Object.keys(response.mappings).length > 0) {
      showMappings(response.mappings);
    } else {
      showEmptyMappings();
    }
  }

  toggleEnabled.addEventListener('change', async () => {
    const status = await sendRuntimeMessage({ type: 'SET_ENABLED', enabled: toggleEnabled.checked });
    updateEnabledUI(status.enabled !== false);
    updateModeUI(status.mode || currentMode);
  });

  Object.entries(modeButtons).forEach(([mode, button]) => {
    button.addEventListener('click', async () => {
      let status = await sendRuntimeMessage({ type: 'SET_MODE', mode });
      if (mode === 'simple' && status?.error === 'simple_model_permission_missing') {
        const granted = await requestSimpleModelDownloadPermission();
        if (granted) {
          status = await sendRuntimeMessage({ type: 'SET_MODE', mode });
        }
      }

      updateEnabledUI(status.enabled !== false);
      updateModeUI(status.mode || mode);
      updateSimpleStatusUI(status.simpleModeModelState || {});
      if (isSimpleModelWorking(status.simpleModeModelState)) startSimplePolling();
      await loadMappings();
    });
  });

  btnAIDownload.addEventListener('click', ensureAIReady);
  btnSimpleLoad.addEventListener('click', ensureSimpleReady);

  btnClear.addEventListener('click', async () => {
    if (!currentTabId || currentMode !== 'reversible') return;
    const response = await sendRuntimeMessage({ type: 'CLEAR_MAPPINGS', tabId: currentTabId });
    if (response?.success) showEmptyMappings();
  });

  btnClearAll.addEventListener('click', async () => {
    if (currentMode !== 'reversible') return;

    const confirmed = window.confirm(
      t('clearAllConfirm')
    );
    if (!confirmed) return;

    const response = await sendRuntimeMessage({ type: 'CLEAR_ALL_MAPPINGS' });
    if (response?.success) showEmptyMappings();
  });

  await refreshStatus();
  await checkAIStatus();
  await checkSimpleStatus();
  if (simpleStatusPoll === null) {
    const status = await sendRuntimeMessage({ type: 'GET_SIMPLE_MODEL_STATUS' });
    if (isSimpleModelWorking(status)) {
      updateSimpleStatusUI(status);
      startSimplePolling();
    }
  }
  await loadMappings();

  setInterval(loadMappings, 2000);
});
