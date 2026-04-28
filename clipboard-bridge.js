/**
 * PII Shield - Main-world clipboard bridge
 *
 * Host pages such as ChatGPT often implement their "copy response" buttons via
 * navigator.clipboard.writeText(), which does not emit a regular copy event.
 * This bridge intercepts those writes in the page world and asks the isolated
 * content script to handle texts that contain known fake values. The content
 * script only answers with a boolean, never with original PII.
 */

(() => {
  'use strict';

  const INSTALL_FLAG = '__piiShieldClipboardBridgeInstalled';
  const SOURCE = 'pii-shield-clipboard-bridge';
  const WRITE_REQUEST = 'PII_SHIELD_CLIPBOARD_WRITE_REQUEST';
  const WRITE_RESPONSE = 'PII_SHIELD_CLIPBOARD_WRITE_RESPONSE';
  const RESPONSE_TIMEOUT_MS = 700;

  if (window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') return;

  const nativeWriteText = clipboard.writeText.bind(clipboard);
  const pendingRequests = new Map();
  let nextRequestId = 0;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data
      || data.source !== SOURCE
      || data.type !== WRITE_RESPONSE
      || typeof data.id !== 'string') {
      return;
    }

    const pending = pendingRequests.get(data.id);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    pendingRequests.delete(data.id);
    pending.resolve(Boolean(data.handled));
  });

  function requestContentScriptWrite(text) {
    if (typeof text !== 'string' || text.length === 0) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const id = `${Date.now()}-${++nextRequestId}`;
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(id);
        resolve(false);
      }, RESPONSE_TIMEOUT_MS);

      pendingRequests.set(id, { resolve, timeoutId });
      window.postMessage({
        source: SOURCE,
        type: WRITE_REQUEST,
        id,
        text,
      }, '*');
    });
  }

  async function patchedWriteText(text) {
    const textValue = typeof text === 'string' ? text : String(text ?? '');
    let handledByExtension = false;

    try {
      handledByExtension = await requestContentScriptWrite(textValue);
    } catch {
      handledByExtension = false;
    }

    if (handledByExtension) return undefined;
    return nativeWriteText(text);
  }

  try {
    Object.defineProperty(clipboard, 'writeText', {
      configurable: true,
      writable: true,
      value: patchedWriteText,
    });
  } catch {
    try {
      Clipboard.prototype.writeText = patchedWriteText;
    } catch {}
  }
})();
