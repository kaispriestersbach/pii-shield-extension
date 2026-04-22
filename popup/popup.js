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

  async function checkAIStatus() {
    try {
      // We check from the popup context – this may not work in all cases
      // since LanguageModel may only be available in the service worker
      if (typeof LanguageModel !== 'undefined') {
        const availability = await LanguageModel.availability();
        updateAIStatusUI(availability);
      } else {
        // Try to check via service worker
        aiStatusIcon.textContent = 'ℹ️';
        aiStatusValue.textContent = 'Prüfung über Service Worker…';
        aiStatusSection.className = 'popup-ai-status';

        // Send a test message to check if the background can access AI
        chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
          if (response) {
            aiStatusIcon.textContent = '✅';
            aiStatusValue.textContent = 'Service Worker bereit';
            aiStatusSection.className = 'popup-ai-status available';
          }
        });
      }
    } catch (err) {
      aiStatusIcon.textContent = '❌';
      aiStatusValue.textContent = 'Nicht verfügbar';
      aiStatusSection.className = 'popup-ai-status unavailable';
    }
  }

  function updateAIStatusUI(availability) {
    switch (availability) {
      case 'available':
        aiStatusIcon.textContent = '✅';
        aiStatusValue.textContent = 'Bereit';
        aiStatusSection.className = 'popup-ai-status available';
        break;
      case 'downloading':
        aiStatusIcon.textContent = '⬇️';
        aiStatusValue.textContent = 'Modell wird heruntergeladen…';
        aiStatusSection.className = 'popup-ai-status';
        break;
      case 'downloadable':
        aiStatusIcon.textContent = '📥';
        aiStatusValue.textContent = 'Modell verfügbar, noch nicht geladen';
        aiStatusSection.className = 'popup-ai-status';
        break;
      default:
        aiStatusIcon.textContent = '❌';
        aiStatusValue.textContent = 'Nicht verfügbar auf diesem Gerät';
        aiStatusSection.className = 'popup-ai-status unavailable';
    }
  }

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
