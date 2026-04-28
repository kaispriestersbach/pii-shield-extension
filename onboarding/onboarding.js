/**
 * First-install mode selection for PII Shield.
 */

document.addEventListener('DOMContentLoaded', () => {
  const { t, setDocumentLanguage, localizeDocument } = globalThis.PIIShieldI18n;

  setDocumentLanguage();
  localizeDocument();

  const form = document.getElementById('onboarding-form');
  const startButton = document.getElementById('onboarding-start');
  const errorBox = document.getElementById('onboarding-error');
  const choices = Array.from(document.querySelectorAll('[data-mode-choice]'));
  const radios = Array.from(document.querySelectorAll('input[name="mode"]'));
  const simpleModelOptionalDownloadOrigins = [
    'https://*.hf.co/*',
  ];

  let selectedMode = 'reversible';

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

  function hideError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function showError(messageKey) {
    errorBox.textContent = t(messageKey);
    errorBox.hidden = false;
  }

  function setSubmitting(submitting) {
    startButton.disabled = submitting;
    startButton.textContent = submitting
      ? t('loading')
      : t(selectedMode === 'simple' ? 'onboardingStartSimple' : 'onboardingStartReversible');
  }

  function updateSelection(mode) {
    selectedMode = mode === 'simple' ? 'simple' : 'reversible';

    choices.forEach((choice) => {
      const selected = choice.dataset.modeChoice === selectedMode;
      choice.classList.toggle('is-selected', selected);
    });

    radios.forEach((radio) => {
      radio.checked = radio.value === selectedMode;
    });

    startButton.textContent = t(
      selectedMode === 'simple' ? 'onboardingStartSimple' : 'onboardingStartReversible'
    );
  }

  choices.forEach((choice) => {
    choice.addEventListener('click', () => {
      hideError();
      updateSelection(choice.dataset.modeChoice);
    });
  });

  radios.forEach((radio) => {
    radio.addEventListener('change', () => {
      hideError();
      updateSelection(radio.value);
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError();
    setSubmitting(true);

    try {
      let status = await sendRuntimeMessage({ type: 'SET_MODE', mode: selectedMode });

      if (selectedMode === 'simple' && status?.error === 'simple_model_permission_missing') {
        const granted = await requestSimpleModelDownloadPermission();
        if (granted) {
          status = await sendRuntimeMessage({ type: 'SET_MODE', mode: selectedMode });
        }
      }

      if (selectedMode === 'simple'
        && (status?.error === 'simple_model_permission_missing' || status?.mode !== 'simple')) {
        updateSelection('reversible');
        showError('onboardingSimplePermissionError');
        return;
      }

      if (status?.error) {
        showError('onboardingGenericError');
        return;
      }

      window.close();
    } catch {
      showError('onboardingGenericError');
    } finally {
      setSubmitting(false);
    }
  });

  updateSelection('reversible');
});
