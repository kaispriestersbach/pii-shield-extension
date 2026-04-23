/**
 * PII Shield – Popup Script
 * 
 * Manages the popup UI: toggle, status display, mapping viewer.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const statusSite = document.getElementById('status-site');
  const statusSection = document.getElementById('status-section');
  const aiStatusIcon = document.getElementById('ai-status-icon');
  const aiStatusValue = document.getElementById('ai-status-value');
  const aiStatusSection = document.getElementById('ai-status-section');
  const mappingsEmpty = document.getElementById('mappings-empty');
  const mappingsTable = document.getElementById('mappings-table');
  const mappingsTbody = document.getElementById('mappings-tbody');
  const btnClear = document.getElementById('btn-clear');
  const btnClearAll = document.getElementById('btn-clear-all');
  const btnAIDownload = document.getElementById('btn-ai-download');

  let aiStatusPoll = null;

  // ─── Get current tab info ───────────────────────────────────────────────

  let currentTabId = null;
  let currentTabUrl = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = String(tab.id);
      currentTabUrl = tab.url || '';
      const hostname = new URL(currentTabUrl).hostname;
      statusSite.textContent = hostname;
    }
  } catch (e) {
    statusSite.textContent = 'Unbekannt';
  }

  // ─── Load enabled state ─────────────────────────────────────────────────

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response) {
      const enabled = response.enabled;
      toggleEnabled.checked = enabled;
      updateStatusUI(enabled);
    }
  });

  // ─── Toggle handler ─────────────────────────────────────────────────────

  toggleEnabled.addEventListener('change', () => {
    const enabled = toggleEnabled.checked;
    chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled }, () => {
      updateStatusUI(enabled);
      if (enabled) ensureAIReady();
    });
  });

  function updateStatusUI(enabled) {
    if (enabled) {
      statusSection.classList.remove('disabled');
      statusText.textContent = 'Aktiv';
      statusIndicator.querySelector('.popup-status-dot').style.background = '#3fb950';
      statusIndicator.querySelector('.popup-status-dot').style.boxShadow = '0 0 6px rgba(63, 185, 80, 0.4)';
    } else {
      statusSection.classList.add('disabled');
      statusText.textContent = 'Deaktiviert';
      statusIndicator.querySelector('.popup-status-dot').style.background = '#8b949e';
      statusIndicator.querySelector('.popup-status-dot').style.boxShadow = 'none';
    }
  }

  // ─── Check AI availability ──────────────────────────────────────────────

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            availability: 'unavailable',
            phase: 'error',
            ready: false,
            errorCode: 'service_worker_error',
            errorMessage: chrome.runtime.lastError.message,
          });
          return;
        }
        resolve(response);
      });
    });
  }

  async function checkAIStatus() {
    aiStatusIcon.textContent = 'ℹ️';
    aiStatusValue.textContent = 'Prüfung im Service Worker…';
    aiStatusSection.className = 'popup-ai-status';
    updateAIStatusUI(await sendRuntimeMessage({ type: 'GET_AI_STATUS' }));
  }

  async function ensureAIReady() {
    btnAIDownload.hidden = false;
    btnAIDownload.disabled = true;
    btnAIDownload.textContent = 'Lädt…';
    updateAIStatusUI(await sendRuntimeMessage({ type: 'ENSURE_AI_READY' }));
    startAIStatusPolling();
  }

  function startAIStatusPolling() {
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

  function formatProgress(progress) {
    if (typeof progress !== 'number') return '';
    return ` (${Math.round(progress * 100)}%)`;
  }

  function updateAIStatusUI(status) {
    const availability = typeof status === 'string' ? status : status?.availability;
    const phase = status?.phase || availability;
    const progress = status?.progress;

    btnAIDownload.hidden = true;
    btnAIDownload.disabled = false;
    btnAIDownload.textContent = 'Modell laden';

    if (phase === 'starting' || phase === 'creating') {
      aiStatusIcon.textContent = '⏳';
      aiStatusValue.textContent = phase === 'creating'
        ? 'Session wird erstellt…'
        : 'Download wird gestartet…';
      aiStatusSection.className = 'popup-ai-status';
      btnAIDownload.hidden = false;
      btnAIDownload.disabled = true;
      btnAIDownload.textContent = 'Lädt…';
      return;
    }

    switch (availability) {
      case 'available':
        aiStatusIcon.textContent = '✅';
        aiStatusValue.textContent = status?.ready
          ? 'Bereit'
          : phase === 'preparing'
            ? 'Modell wird vorbereitet…'
            : 'Session wird erstellt…';
        aiStatusSection.className = 'popup-ai-status available';
        break;
      case 'downloading':
        aiStatusIcon.textContent = '⬇️';
        aiStatusValue.textContent = `Modell wird heruntergeladen…${formatProgress(progress)}`;
        aiStatusSection.className = 'popup-ai-status';
        btnAIDownload.hidden = false;
        btnAIDownload.disabled = true;
        btnAIDownload.textContent = 'Lädt…';
        break;
      case 'downloadable':
        aiStatusIcon.textContent = '📥';
        aiStatusValue.textContent = 'Modell noch nicht geladen';
        aiStatusSection.className = 'popup-ai-status';
        btnAIDownload.hidden = false;
        break;
      case 'error':
        aiStatusIcon.textContent = '❌';
        aiStatusValue.textContent = status?.errorMessage
          ? `Fehler: ${status.errorMessage}`
          : 'Statusprüfung fehlgeschlagen';
        aiStatusSection.className = 'popup-ai-status unavailable';
        break;
      default:
        aiStatusIcon.textContent = '❌';
        aiStatusValue.textContent = status?.errorCode === 'ai_api_missing'
          ? 'Prompt API nicht in diesem Kontext verfügbar'
          : 'Nicht verfügbar auf diesem Gerät';
        aiStatusSection.className = 'popup-ai-status unavailable';
    }
  }

  btnAIDownload.addEventListener('click', ensureAIReady);

  checkAIStatus();

  // ─── Load mappings ──────────────────────────────────────────────────────

  function loadMappings() {
    if (!currentTabId) {
      showEmptyMappings();
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'GET_MAPPINGS', tabId: currentTabId },
      (response) => {
        if (response && response.mappings && Object.keys(response.mappings).length > 0) {
          showMappings(response.mappings);
        } else {
          showEmptyMappings();
        }
      }
    );
  }

  function showMappings(mappings) {
    mappingsEmpty.style.display = 'none';
    mappingsTable.style.display = 'table';
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
    mappingsEmpty.style.display = 'block';
    mappingsTable.style.display = 'none';
  }

  loadMappings();

  // ─── Clear mappings ─────────────────────────────────────────────────────

  btnClear.addEventListener('click', () => {
    if (!currentTabId) return;

    chrome.runtime.sendMessage(
      { type: 'CLEAR_MAPPINGS', tabId: currentTabId },
      (response) => {
        if (response && response.success) {
          showEmptyMappings();
        }
      }
    );
  });

  btnClearAll.addEventListener('click', () => {
    const confirmed = window.confirm(
      'Alle Mappings für alle Tabs unwiderruflich löschen?\n\n' +
      'Nach dem Löschen können kopierte Antworten nicht mehr automatisch zu den Originaldaten zurückgeführt werden.'
    );
    if (!confirmed) return;

    chrome.runtime.sendMessage({ type: 'CLEAR_ALL_MAPPINGS' }, (response) => {
      if (response && response.success) {
        showEmptyMappings();
      }
    });
  });

  // ─── Auto-refresh mappings ──────────────────────────────────────────────

  // Refresh mappings every 2 seconds while popup is open
  setInterval(loadMappings, 2000);
});
