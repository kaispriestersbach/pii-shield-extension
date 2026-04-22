/**
 * PII Shield – Background Service Worker
 * 
 * Handles PII detection via Chrome Built-in AI (Gemini Nano)
 * and manages the anonymization/de-anonymization mapping.
 */

// ─── State ───────────────────────────────────────────────────────────────────

/** @type {Map<string, Map<string, string>>} tabId → (fake → real) */
const mappings = new Map();

/** @type {LanguageModelSession|null} */
let aiSession = null;

/** Whether the extension is enabled */
let isEnabled = true;

// ─── AI Session Management ──────────────────────────────────────────────────

async function getAISession() {
  if (aiSession) return aiSession;

  try {
    const availability = await LanguageModel.availability();
    console.log('[PII Shield] AI availability:', availability);

    if (availability === 'unavailable') {
      console.error('[PII Shield] Gemini Nano is not available on this device.');
      return null;
    }

    aiSession = await LanguageModel.create({
      initialPrompts: [
        {
          role: 'system',
          content: `You are a PII (Personally Identifiable Information) detection and anonymization engine.

Your task: Given a text, identify ALL PII entities and return a JSON object mapping each original PII value to a realistic but fake replacement.

PII categories to detect:
- Full names (first name, last name, full name)
- Email addresses
- Phone numbers (any format)
- Physical addresses (street, city, zip, country)
- Dates of birth
- Social security numbers / national ID numbers
- Credit card numbers
- IBAN / bank account numbers
- IP addresses
- Company names (when they identify a specific real company in context)
- Passport numbers
- Driver's license numbers
- Medical record numbers
- Any other personally identifying information

Rules for replacements:
1. Replacements MUST be realistic and plausible (e.g., replace a German name with another German name, a US phone with another US phone format).
2. Replacements MUST preserve the format (e.g., email → email, phone → phone with same format).
3. Replacements MUST be consistent: if "John Smith" appears 3 times, always map to the same fake name.
4. Do NOT flag generic terms, common nouns, or non-identifying information.
5. Do NOT modify code, technical terms, or non-PII content.

IMPORTANT: Respond ONLY with a valid JSON object. No explanation, no markdown, no code fences.
Example response format:
{"John Smith": "Michael Weber", "john.smith@acme.com": "m.weber@example.de", "+49 170 1234567": "+49 151 9876543", "Musterstraße 42, 10115 Berlin": "Lindenweg 7, 80331 München"}`
        }
      ]
    });

    console.log('[PII Shield] AI session created successfully.');
    return aiSession;
  } catch (err) {
    console.error('[PII Shield] Failed to create AI session:', err);
    aiSession = null;
    return null;
  }
}

// ─── Replacement Engine ─────────────────────────────────────────────────────

/**
 * Build a flat list of replacement entries from a Map<from, to>.
 * For multi-word name-like values, also emits per-component entries so that
 * partial references ("Weber" instead of "Thomas Weber") are still replaced.
 */
function buildReplacementEntries(map) {
  const entries = [];
  const NAME_PART = /^[\p{L}\-]+$/u;

  for (const [from, to] of map) {
    if (!from || !to) continue;
    entries.push({ from, to });

    const fromParts = from.split(/\s+/);
    const toParts = to.split(/\s+/);
    if (fromParts.length === toParts.length && fromParts.length >= 2) {
      for (let i = 0; i < fromParts.length; i++) {
        if (fromParts[i].length >= 3 && toParts[i].length >= 2 &&
            NAME_PART.test(fromParts[i]) && NAME_PART.test(toParts[i])) {
          entries.push({ from: fromParts[i], to: toParts[i] });
        }
      }
    }
  }

  // Longest first so "Thomas Weber" wins over "Weber" alone.
  entries.sort((a, b) => b.from.length - a.from.length);
  return entries;
}

/**
 * Apply replacements to a text. Word-like values (letters/hyphens) use a
 * Unicode-aware word boundary and preserve up to 2 trailing letters so that
 * German inflections ("Webers", "Müllern") are carried over to the replacement.
 * Everything else (emails, phone numbers, IBANs) uses exact substring match.
 */
function applyReplacements(text, entries) {
  const WORD_LIKE = /^[\p{L}\p{N}\s\-]+$/u;
  let result = text;

  for (const { from, to } of entries) {
    if (WORD_LIKE.test(from)) {
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(
        `(?<=^|[^\\p{L}\\p{N}_])${escaped}(\\p{L}{0,2})(?=$|[^\\p{L}\\p{N}_])`,
        'gu'
      );
      result = result.replace(re, (_, suffix) => to + suffix);
    } else {
      result = result.split(from).join(to);
    }
  }
  return result;
}

// ─── PII Detection & Anonymization ─────────────────────────────────────────

/**
 * Detect PII in text using Gemini Nano and return anonymized text + mapping.
 * @param {string} text - The original text to scan
 * @param {string} tabId - The tab identifier for mapping storage
 * @returns {Promise<{anonymizedText: string, replacements: Object, hasPII: boolean}>}
 */
async function detectAndAnonymize(text, tabId) {
  const session = await getAISession();

  if (!session) {
    return { anonymizedText: text, replacements: {}, hasPII: false, error: 'ai_unavailable' };
  }

  try {
    const prompt = `Analyze the following text for PII and return a JSON mapping of original → replacement values. If no PII is found, return an empty JSON object {}.

Text to analyze:
"""
${text}
"""`;

    const response = await session.prompt(prompt);

    // Parse the JSON response
    let replacements = {};
    try {
      // Try to extract JSON from the response (handle potential markdown wrapping)
      let jsonStr = response.trim();
      // Remove potential code fences
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      replacements = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.warn('[PII Shield] Failed to parse AI response as JSON:', response);
      // Try a more aggressive extraction
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          replacements = JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error('[PII Shield] Could not extract JSON from response.');
          return { anonymizedText: text, replacements: {}, hasPII: false, error: 'parse_failed' };
        }
      } else {
        return { anonymizedText: text, replacements: {}, hasPII: false, error: 'parse_failed' };
      }
    }

    const hasPII = Object.keys(replacements).length > 0;

    if (!hasPII) {
      return { anonymizedText: text, replacements: {}, hasPII: false };
    }

    // Store the mapping (fake → real) for later de-anonymization
    if (!mappings.has(tabId)) {
      mappings.set(tabId, new Map());
    }
    const tabMapping = mappings.get(tabId);

    // Store reverse mapping (fake → real) for later de-anonymization.
    const origToFake = new Map();
    for (const [original, fake] of Object.entries(replacements)) {
      if (!original || !fake) continue;
      origToFake.set(original, fake);
      tabMapping.set(fake, original);
    }

    // Apply replacements with Unicode-aware word boundaries + inflection support.
    const entries = buildReplacementEntries(origToFake);
    const anonymizedText = applyReplacements(text, entries);

    // Persist mapping to storage
    await saveMappings();

    console.log(`[PII Shield] Found ${Object.keys(replacements).length} PII entities.`);
    return { anonymizedText, replacements, hasPII };

  } catch (err) {
    console.error('[PII Shield] Error during PII detection:', err);
    aiSession = null;
    return { anonymizedText: text, replacements: {}, hasPII: false, error: 'detection_failed' };
  }
}

/**
 * De-anonymize text by reversing all known fake → real mappings.
 * @param {string} text - Text containing fake PII values
 * @param {string} tabId - The tab identifier
 * @returns {string} Text with original PII restored
 */
function deanonymize(text, tabId) {
  const tabMapping = mappings.get(tabId);
  if (!tabMapping || tabMapping.size === 0) return text;
  const entries = buildReplacementEntries(tabMapping);
  return applyReplacements(text, entries);
}

// ─── Storage ────────────────────────────────────────────────────────────────

async function saveMappings() {
  const serializable = {};
  for (const [tabId, map] of mappings) {
    serializable[tabId] = Object.fromEntries(map);
  }
  await chrome.storage.session.set({ piiMappings: serializable });
}

async function loadMappings() {
  // Remove any legacy plaintext mappings from chrome.storage.local (pre-session-storage versions)
  try { await chrome.storage.local.remove('piiMappings'); } catch (_) {}

  const result = await chrome.storage.session.get('piiMappings');
  if (result.piiMappings) {
    for (const [tabId, obj] of Object.entries(result.piiMappings)) {
      mappings.set(tabId, new Map(Object.entries(obj)));
    }
  }

  // Drop mappings for tabs that no longer exist (cleanup after SW restart)
  try {
    const existingTabs = await chrome.tabs.query({});
    const existingIds = new Set(existingTabs.map(t => String(t.id)));
    let changed = false;
    for (const tabId of [...mappings.keys()]) {
      if (!existingIds.has(tabId)) {
        mappings.delete(tabId);
        changed = true;
      }
    }
    if (changed) await saveMappings();
  } catch (err) {
    console.warn('[PII Shield] Orphan tab cleanup failed:', err);
  }
}

async function loadEnabled() {
  const result = await chrome.storage.local.get('piiShieldEnabled');
  if (result.piiShieldEnabled !== undefined) {
    isEnabled = result.piiShieldEnabled;
  }
}

// ─── Message Handling ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = String(sender.tab?.id || message.tabId || 'unknown');

  switch (message.type) {
    case 'ANONYMIZE_TEXT': {
      if (!isEnabled) {
        sendResponse({ anonymizedText: message.text, replacements: {}, hasPII: false });
        return false;
      }
      // Async handler
      detectAndAnonymize(message.text, tabId)
        .then(result => sendResponse(result))
        .catch(err => {
          console.error('[PII Shield] Anonymization error:', err);
          sendResponse({ anonymizedText: message.text, replacements: {}, hasPII: false, error: 'detection_failed' });
        });
      return true; // Keep channel open for async response
    }

    case 'DEANONYMIZE_TEXT': {
      const result = deanonymize(message.text, tabId);
      sendResponse({ deanonymizedText: result });
      return false;
    }

    case 'GET_MAPPINGS': {
      const tabMapping = mappings.get(tabId);
      const entries = tabMapping ? Object.fromEntries(tabMapping) : {};
      sendResponse({ mappings: entries });
      return false;
    }

    case 'CLEAR_MAPPINGS': {
      mappings.delete(tabId);
      saveMappings();
      sendResponse({ success: true });
      return false;
    }

    case 'GET_STATUS': {
      sendResponse({ enabled: isEnabled });
      return false;
    }

    case 'SET_ENABLED': {
      isEnabled = message.enabled;
      chrome.storage.local.set({ piiShieldEnabled: isEnabled });
      sendResponse({ enabled: isEnabled });
      return false;
    }

    case 'GET_ALL_MAPPINGS': {
      const allMappings = {};
      for (const [tid, map] of mappings) {
        allMappings[tid] = Object.fromEntries(map);
      }
      sendResponse({ mappings: allMappings });
      return false;
    }

    default:
      sendResponse({ error: 'Unknown message type' });
      return false;
  }
});

// ─── Tab Cleanup ────────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  const key = String(tabId);
  if (mappings.has(key)) {
    mappings.delete(key);
    saveMappings();
    console.log(`[PII Shield] Cleaned up mappings for closed tab ${tabId}.`);
  }
});

// ─── Initialization ─────────────────────────────────────────────────────────

loadMappings();
loadEnabled();

console.log('[PII Shield] Background service worker initialized.');
