# Privacy Review Hardening Plan

This document records the privacy-hardening work that shaped the current
extension architecture. It is kept as developer context for future changes.

## Implemented In This Codebase

- Content banners no longer render original values or fake values into the host
  page DOM.
- Paste failures are fail-closed: AI errors, parse errors, timeouts, and service
  worker failures block insertion instead of silently inserting the original.
- The popup reads model availability through service worker status messages.
- Copy de-anonymization mirrors mappings locally in the content script and runs
  synchronously inside the copy event.
- Mappings stay in `chrome.storage.session` and are cleared on tab close,
  navigation, explicit clear, and inactivity TTL.
- Reversible mode uses structured Prompt API output through
  `responseConstraint`.
- Deterministic detectors cover high-signal structured PII such as email, IBAN,
  credit cards, phone numbers, IP addresses, and dates.
- Replacement is span-based and avoids cascading replacements.
- Clipboard permissions were removed; clipboard access happens through real
  paste/copy events.
- Runtime UI is localized through Chrome i18n with English fallback and explicit
  support for English, German, French, Spanish, Italian, and Dutch.

## Current Architecture Notes

- `background.js` is the source of truth for enabled state, mode, Gemini Nano
  status, Privacy Filter download/cache state, and tab-local mappings.
- `content.js` performs paste/copy interception, renders privacy-safe status UI,
  and keeps a local mapping mirror for synchronous copy handling.
- `popup/` shows state, mode selection, model download progress, and tab-local
  mappings.
- `offscreen/` runs OpenAI Privacy Filter locally over WebGPU after the model is
  downloaded and cached by the extension.
- `_locales/` contains all user-facing runtime strings.

## Future Review Checklist

1. Keep banners data-minimal. They may show counts, categories, and generic
   status, but not original PII, fake values, or mapping details.
2. Keep paste failures fail-closed unless the user makes an explicit manual
   decision outside the automatic paste path.
3. Keep copy de-anonymization synchronous. Do not move the critical copy path
   back behind an async service worker round trip.
4. Keep mappings in `chrome.storage.session`; do not persist PII mappings in
   `chrome.storage.local`.
5. Validate model output strictly and fall back to deterministic detectors for
   structured PII.
6. Treat model quality claims carefully. The benchmark-backed UI languages are
   `en`, `de`, `fr`, `es`, `it`, and `nl`, but quality can vary by region,
   script, domain, and PII type.
7. Update `_locales/*/messages.json` whenever user-facing UI text changes.

## Validation

- `npm run test:unit`
- `npm run test`
- Manual smoke test in Chrome 138+:
  - paste with PII transforms text without writing original values into the host
    page DOM;
  - model/API failure blocks automatic paste;
  - copy restores known fake values synchronously in Reversible Mode;
  - clear actions remove mappings from popup and content script state;
  - Simple Mode requests Hugging Face download permission only when needed and
    then runs analysis locally.
