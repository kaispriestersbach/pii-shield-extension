# PII Shield - AI Privacy Guard

[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-1f6feb)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![Chrome 138+](https://img.shields.io/badge/Chrome-138%2B-34a853)](manifest.json)
[![Local first](https://img.shields.io/badge/Privacy-local--first-0f766e)](#privacy-and-security-model)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE)

Created and maintained by [Kai Spriestersbach](https://www.afaik.de)
([kai@afaik.de](mailto:kai@afaik.de)).

**PII Shield** is a Chrome extension that reduces the risk of exposing
personally identifiable information (PII) to AI chatbots. It intercepts text
before it reaches supported chatbot pages, detects sensitive values locally in
the browser, and either replaces them with plausible synthetic data or masks
them with typed placeholders.

The extension is designed for everyday AI-assisted work where prompts often
contain names, emails, phone numbers, addresses, contracts, customer context, or
other sensitive operational details. It is local-first, has no backend service,
and keeps runtime permissions scoped to the sites it protects.

## Key Features

- **Local PII analysis:** text is analyzed in the browser through Gemini Nano or
  OpenAI Privacy Filter, with deterministic validators for structured values.
- **Two privacy modes:** choose reversible anonymization for workflows that need
  copy-back restoration, or simple placeholder masking for one-way redaction.
- **Copy-back restoration:** in Reversible Mode, known fake values in copied
  chatbot responses are replaced with their original values from a tab-local
  mapping.
- **Privacy-safe UI:** banners show status, counts, and categories, but never
  render original values or replacement mappings into the host page.
- **Scoped storage:** reversible mappings are isolated per tab, stored in
  `chrome.storage.session`, and cleared on navigation, tab close, explicit
  clear, and inactivity TTL.
- **Internationalized UI:** Chrome i18n catalogs are provided for English,
  German, French, Spanish, Italian, and Dutch.
- **Automated coverage:** unit tests cover replacement, masking, and
  deterministic detectors; Playwright tests cover extension behavior across the
  supported chatbot fixtures.

## Modes At A Glance

| Mode | Best for | Paste behavior | Copy behavior | Local runtime |
|------|----------|----------------|---------------|---------------|
| **Reversible** | Drafting with copied responses that should contain the original values again | Replaces detected PII with realistic fake values | Restores known fake values from tab-local mappings | Chrome Prompt API with Gemini Nano plus deterministic detectors |
| **Simple** | One-way redaction where originals should not be recoverable from chatbot output | Masks detected PII with typed placeholders such as `<PRIVATE_EMAIL>` | Leaves copied text unchanged | OpenAI Privacy Filter q4 through Transformers.js, ONNX Runtime, and WebGPU plus deterministic detectors |

## How It Works

1. **Paste interception:** the content script intercepts user paste events on
   supported chatbot domains before the page receives the clipboard text.
2. **Local analysis:** the background service worker sends the text to the
   selected local runtime and merges model output with deterministic detectors.
3. **Transformation:** PII spans are replaced atomically, avoiding cascading or
   overlapping replacements.
4. **Safe insertion:** transformed text is inserted into the active input. If
   analysis fails in the automatic path, the extension avoids silently inserting
   the original sensitive text.
5. **Copy handling:** in Reversible Mode only, copied chatbot output is checked
   against the local tab mapping and restored synchronously inside the copy
   event.

Example in Reversible Mode:

```text
Original clipboard text:
Please draft an email to Max Mustermann (max.mustermann@example.com,
phone +49 170 1234567) about the contract for Musterstrasse 42,
10115 Berlin.

Text inserted into the chatbot:
Please draft an email to Thomas Weber (t.weber@example.com,
phone +49 151 9876543) about the contract for Lindenallee 7,
80331 Munich.
```

## Detected PII Categories

PII Shield combines model-based recognition with deterministic validators for
high-signal structured values.

| Category | Examples |
|----------|----------|
| Names | First names, last names, full names, honorifics |
| Email addresses | `max.mustermann@example.com` |
| Phone numbers | `+49 170 1234567`, `030/12345678` |
| Physical addresses | Street, postal code, city, country |
| Dates | `1985-03-15`, `15.03.1985` |
| National identifiers | Country-specific ID numbers |
| Credit cards | Visa, Mastercard, and similar card numbers validated with checksum logic |
| IBAN and bank data | `DE89 3704 0044 0532 0130 00` |
| IP addresses | `192.168.1.100` |
| Company names | Specific company identifiers and legal suffixes |
| Other identifiers | Passport-like, driver-license-like, medical-record-like, or contextual identifiers |

Model detection is probabilistic and can produce false positives or false
negatives. PII Shield reduces exposure risk; it does not replace a human review
process for sensitive, regulated, contractual, or high-impact data.

## Supported Sites

PII Shield is active only on the configured host permissions below.

| Platform | Host |
|----------|------|
| ChatGPT | `chatgpt.com`, `chat.openai.com` |
| Claude | `claude.ai` |
| Gemini | `gemini.google.com` |
| Microsoft Copilot | `copilot.microsoft.com` |
| Mistral Le Chat | `chat.mistral.ai` |
| DeepSeek | `chat.deepseek.com` |
| Grok | `grok.com` |
| Meta AI | `www.meta.ai` |
| Poe | `poe.com` |
| Hugging Face Chat | `huggingface.co/chat` |
| Qwen Chat | `chat.qwen.ai` |
| Perplexity | `www.perplexity.ai` |
| You.com | `you.com` |
| Phind | `www.phind.com` |

## Requirements

| Requirement | Reversible Mode | Simple Mode |
|-------------|-----------------|-------------|
| Browser | Chrome 138 or newer | Chrome 138 or newer |
| Extension platform | Manifest V3 | Manifest V3 |
| Local AI runtime | Chrome Prompt API with Gemini Nano | WebGPU-capable browser profile |
| Model setup | Gemini Nano must be available in Chrome | Privacy Filter model is downloaded once from Hugging Face and cached locally |
| Network access | Not needed for prompt processing once Gemini Nano is available | Needed only for the initial model download and cache refresh |

### Enable Gemini Nano For Reversible Mode

Reversible Mode depends on Chrome's local Prompt API runtime. On development
profiles, the required Chrome flags may need to be enabled manually:

1. Open `chrome://flags/#optimization-guide-on-device-model` and set it to
   **Enabled BypassPerfRequirement**.
2. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and set it
   to **Enabled**.
3. Restart Chrome.
4. Open `chrome://components/` and check whether **Optimization Guide On Device
   Model** is available. Use **Check for update** if Chrome has not downloaded
   the local model yet.

## Chrome Web Store Package

Store-ready ZIP packages are attached to
[GitHub Releases](https://github.com/kaispriestersbach/pii-shield-extension/releases).
For the current release, download
[`pii-shield-extension-v1.1.1-chrome-store.zip`](https://github.com/kaispriestersbach/pii-shield-extension/releases/download/v1.1.1/pii-shield-extension-v1.1.1-chrome-store.zip)
from
[PII Shield v1.1.1](https://github.com/kaispriestersbach/pii-shield-extension/releases/tag/v1.1.1)
and upload that ZIP in the Chrome Web Store Developer Dashboard.

## Installation From Source

```bash
git clone <repository-url>
cd pii-shield-extension
npm ci
npm run build
```

Then load the extension in Chrome:

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the `pii-shield-extension` directory.
5. Pin **PII Shield** from the toolbar menu if you want quick access to mode and
   model status.

`npm run build` stages the local offscreen runtime files used by Simple Mode
from `@huggingface/transformers` into `offscreen/vendor/`. That directory is
generated and intentionally ignored by Git.

## First Run

1. Open a supported chatbot site.
2. Confirm that the floating PII Shield badge is visible.
3. Open the extension popup to check runtime status.
4. Keep **Reversible** selected if copied responses should restore original
   values.
5. Switch to **Simple** if one-way placeholder masking is preferred. On first
   use, Chrome asks for one-time access to the Hugging Face model file host so
   the Privacy Filter model can be cached locally.

## Privacy And Security Model

PII Shield is built around a local-first privacy model:

- **No backend:** the extension does not include a server component.
- **No telemetry:** the codebase contains no analytics, tracking, or usage
  reporting.
- **Local analysis:** prompt text is analyzed in the browser by local runtimes.
- **Controlled Simple Mode download:** `https://huggingface.co/chat/*` is a
  required host because Hugging Face Chat is a supported site. Simple Mode only
  requests additional optional host permission for `https://*.hf.co/*` to allow
  Hugging Face model file delivery when the `openai/privacy-filter` model is
  downloaded.
- **Session-scoped reversible mappings:** fake-to-original mappings are kept in
  `chrome.storage.session`, isolated by tab, and cleared automatically.
- **Host-scoped execution:** content scripts run only on supported chatbot
  domains listed in `manifest.json`.
- **Data-minimal page UI:** notifications never expose original PII or mapping
  values to the host document.
- **Fail-closed automatic paste path:** runtime errors, parse failures, and
  timeouts do not silently insert the original sensitive clipboard text.

For additional engineering notes, see
[`docs/privacy-review-hardening-plan.md`](docs/privacy-review-hardening-plan.md).

## Architecture

| Path | Responsibility |
|------|----------------|
| `manifest.json` | Chrome Manifest V3 definition, permissions, content-script matches, CSP, and minimum Chrome version |
| `background.js` | Service worker orchestration, mode state, Gemini Nano session management, Privacy Filter download/cache state, tab-local mappings |
| `content.js` | Paste/copy interception, badge UI, notifications, privacy-safe page overlays, local mapping mirror for synchronous copy restoration |
| `popup/` | Extension popup for enable/disable state, mode switching, model readiness, and active reversible mappings |
| `offscreen/` | Offscreen document and local Privacy Filter runtime for Simple Mode |
| `replacement-engine.js` | Span-safe reversible replacement and copy-back restoration helpers |
| `masking-engine.js` | Simple Mode span merging, category mapping, and placeholder masking |
| `pii-detectors.js` | Deterministic detectors and contextual replacement helpers |
| `_locales/` | Chrome i18n message catalogs |
| `tests/` | Unit and Playwright integration tests |

## Development

```bash
npm ci
npm run build
npm run test:unit
npm run test
```

Useful scripts:

| Command | Purpose |
|---------|---------|
| `npm run build` | Stage the offscreen Transformers.js and ONNX runtime files |
| `npm run test:unit` | Run unit tests for replacement, deterministic detectors, and masking |
| `npm run test` | Run Playwright extension integration tests |
| `npm run test:all` | Run unit and Playwright tests |
| `npm run serve:fixtures` | Serve local chatbot fixtures for manual debugging |

When changing user-facing text, update every locale in `_locales/*/messages.json`.
When changing supported sites, update both `host_permissions` and
`content_scripts.matches` in `manifest.json`, then add or adjust fixtures and
integration coverage.

## Packaging Checklist

Before preparing an unpacked release or store package:

1. Run `npm ci`.
2. Run `npm run build`.
3. Run `npm run test:all`.
4. Load the extension in a clean Chrome profile.
5. Smoke test Reversible Mode paste/copy restoration on at least one supported
   chatbot page.
6. Smoke test Simple Mode first-run permission, model download/cache state, and
   placeholder masking.
7. Confirm the package excludes `node_modules/`, `test-build/`,
   `playwright-report/`, `test-results/`, and local model cache files.

## Limitations

- Gemini Nano availability depends on Chrome version, flags, hardware, policy,
  and profile state.
- Simple Mode requires WebGPU and enough browser-cache storage for the local
  Privacy Filter model.
- Model output can miss PII or classify non-PII as sensitive.
- Only text handled through paste/copy events is transformed; file uploads,
  screenshots, voice input, and page content outside clipboard workflows are not
  inspected.
- Browser UI languages outside the bundled locales fall back to English.
- Supported chatbot sites can change their DOM and clipboard behavior over time;
  integration tests should be updated when a platform changes.

## Maintainer

PII Shield is created and maintained by
[Kai Spriestersbach](https://www.afaik.de)
([kai@afaik.de](mailto:kai@afaik.de)), with a focus on privacy-preserving AI
workflows, local-first browser tooling, and secure automation.

## License

PII Shield is released under the
[Creative Commons Attribution-NonCommercial 4.0 International License
(CC BY-NC 4.0)](LICENSE). You are free to share and adapt the work for
non-commercial purposes, provided that you give appropriate credit to
Kai Spriestersbach.
