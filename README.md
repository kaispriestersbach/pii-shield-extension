# PII Shield - AI Privacy Guard

**Software author: Kai Spriestersbach**

PII Shield is a Chrome extension that helps protect personally identifiable
information (PII) before text is pasted into AI chatbots. It runs in the
browser and supports two operating modes.

- **Reversible Mode:** replaces PII with plausible fake values when pasting and
  restores known fake values to the originals when copying answers back out.
- **Simple Mode:** masks PII with typed placeholders such as `<PRIVATE_EMAIL>`
  or `<PRIVATE_PERSON>` using OpenAI Privacy Filter locally in the browser. The
  model is downloaded once from Hugging Face, cached by the extension, and then
  executed locally over WebGPU.

Text being checked is not sent to Hugging Face or any other server. In Simple
Mode, only model files are downloaded.

---

## Internationalization

The extension UI uses Chrome's native `chrome.i18n` system. English is the
default locale and fallback for unsupported browser languages. The explicitly
supported UI locales are:

| Locale | Language |
|--------|----------|
| `en` | English |
| `de` | German |
| `fr` | French |
| `es` | Spanish |
| `it` | Italian |
| `nl` | Dutch |

These languages are also tracked in code as benchmark-backed Privacy Filter
languages. English, German, French, Spanish, Italian, and Dutch are separately
reported in the multilingual PII-Masking-300k benchmark. This is not a guarantee
of equal quality for every region, writing style, or PII type; users should
expect model performance to vary outside the training and evaluation
distribution.

Sources: [OpenAI Privacy Filter on Hugging Face](https://huggingface.co/openai/privacy-filter)
and the [OpenAI Privacy Filter Model Card](https://cdn.openai.com/pdf/c66281ed-b638-456a-8ce1-97e9f5264a90/OpenAI-Privacy-Filter-Model-Card.pdf).

---

## Modes

| Mode | Paste behavior | Copy behavior | Local runtime |
|------|----------------|---------------|---------------|
| **Reversible** | Fake values replace original PII | Known fake values are restored locally | Gemini Nano + deterministic detectors |
| **Simple** | Typed placeholders replace original PII | No reverse mapping | OpenAI Privacy Filter + deterministic detectors |

---

## How It Works

1. **Paste:** the content script intercepts paste events before the chatbot app
   receives the text.
2. **Analyze:** the service worker runs local PII detection through Gemini Nano
   or OpenAI Privacy Filter, plus deterministic detectors for structured data.
3. **Transform:** detected PII is replaced or masked before insertion.
4. **Copy:** in Reversible Mode only, known fake values are synchronously
   restored during copy events using tab-local mappings.

Example:

Original clipboard text:

> Please draft an email to Max Mustermann (max.mustermann@example.com, phone
> +49 170 1234567) about the contract for Musterstrasse 42, 10115 Berlin.

Text inserted into the chatbot in Reversible Mode:

> Please draft an email to Thomas Weber (t.weber@example.com, phone
> +49 151 9876543) about the contract for Lindenallee 7, 80331 Munich.

---

## Detected PII Categories

PII Shield combines model-based detection with deterministic validators for
high-signal structured data.

| Category | Examples |
|----------|----------|
| Names | First and last names, full names |
| Email addresses | `max.mustermann@example.com` |
| Phone numbers | `+49 170 1234567`, `030/12345678` |
| Physical addresses | Street, postal code, city, country |
| Dates | `1985-03-15`, `15.03.1985` |
| National IDs | Country-specific ID numbers |
| Credit card numbers | Visa, Mastercard, and similar card numbers |
| IBAN / bank data | `DE89 3704 0044 0532 0130 00` |
| IP addresses | `192.168.1.100` |
| Company names | Specific company identifiers and legal suffixes |

Model detection remains probabilistic. Deterministic detectors improve coverage
for structured categories but do not replace a full privacy review.

---

## Supported Platforms

PII Shield is active on these chatbot and AI-search domains:

| Platform | Domain |
|----------|--------|
| ChatGPT | `chatgpt.com`, `chat.openai.com` |
| Claude | `claude.ai` |
| Gemini | `gemini.google.com` |
| Copilot | `copilot.microsoft.com` |
| Mistral / Le Chat | `chat.mistral.ai` |
| DeepSeek | `chat.deepseek.com` |
| Grok | `grok.com` |
| Meta AI | `www.meta.ai` |
| Poe | `poe.com` |
| Hugging Face Chat | `huggingface.co/chat` |
| Qwen Chat | `chat.qwen.ai` |
| Perplexity | `www.perplexity.ai` |
| You.com | `you.com` |
| Phind | `www.phind.com` |

---

## Installation

### Requirements

PII Shield requires Chrome 138 or newer with Gemini Nano support for Reversible
Mode.

1. Open `chrome://flags/#optimization-guide-on-device-model` and set it to
   **Enabled BypassPerfRequirement**.
2. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and set it
   to **Enabled**.
3. Restart Chrome.
4. Open `chrome://components/` and check whether **Optimization Guide On Device
   Model** is available. Use **Check for update** if needed.

Simple Mode additionally requires WebGPU and enough browser-cache storage for
the OpenAI Privacy Filter model.

### Load the Extension

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the `pii-shield-extension` folder.
5. The extension appears in the toolbar.

---

## Privacy And Security

- **Local analysis:** text analysis runs in the browser.
- **Controlled model download:** Simple Mode downloads only model files from
  `openai/privacy-filter` on Hugging Face and caches them locally.
- **No backend:** there is no external server, telemetry, or tracking.
- **Minimal permissions:** runtime host permissions are limited to supported
  chatbot sites; Hugging Face access is requested only when Simple Mode needs to
  download the model.
- **No PII in host DOM:** banners show status and counts, not original values or
  mapping details.
- **Tab-local mappings:** mappings are stored in `chrome.storage.session`, are
  isolated by tab, and are cleared on tab close, navigation, explicit clear, and
  inactivity TTL.

---

## Development

```bash
npm install
npm run build
npm run test:unit
npm run test
```

Important runtime files:

- `background.js`: service worker orchestration, mode state, model download,
  cache checks, and tab-local mappings.
- `content.js`: paste/copy interception, page-level notifications, and badge UI.
- `popup/`: extension popup UI and model status controls.
- `offscreen/`: local OpenAI Privacy Filter runtime.
- `_locales/`: Chrome i18n message catalogs.

---

## Limitations

- Gemini Nano availability depends on Chrome version, flags, hardware, and
  profile state.
- WebGPU is required for Simple Mode.
- Model-based detection may produce false positives or false negatives.
- Unsupported browser UI languages fall back to English.
- Only text pasted through clipboard events is analyzed; file uploads are not
  inspected.

---

## License

MIT License.
