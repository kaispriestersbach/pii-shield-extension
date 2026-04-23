/**
 * Shared Chrome i18n helpers for extension pages and content scripts.
 */

(() => {
  'use strict';

  function normalizeSubstitutions(substitutions) {
    if (substitutions === undefined || substitutions === null) return undefined;
    const values = Array.isArray(substitutions) ? substitutions : [substitutions];
    return values.map((value) => String(value));
  }

  function t(key, substitutions, fallback = '') {
    const normalized = normalizeSubstitutions(substitutions);
    const message = chrome.i18n?.getMessage?.(key, normalized);
    return message || fallback || key;
  }

  function getUILanguage() {
    return chrome.i18n?.getUILanguage?.() || 'en';
  }

  function setDocumentLanguage(doc = document) {
    if (!doc?.documentElement) return;
    doc.documentElement.lang = getUILanguage().split('-')[0] || 'en';
  }

  function localizeDocument(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = t(element.getAttribute('data-i18n'));
    });

    root.querySelectorAll('[data-i18n-title]').forEach((element) => {
      element.setAttribute('title', t(element.getAttribute('data-i18n-title')));
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria-label')));
    });
  }

  globalThis.PIIShieldI18n = {
    t,
    getUILanguage,
    setDocumentLanguage,
    localizeDocument,
  };
})();
