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
    // Fallback: return text unchanged if AI is not available
    return { anonymizedText: text, replacements: {}, hasPII: false };
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
          return { anonymizedText: text, replacements: {}, hasPII: false };
        }
      } else {
        return { anonymizedText: text, replacements: {}, hasPII: false };
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

    // Apply replacements to text (sort by length descending to avoid partial matches)
    let anonymizedText = text;
    const sortedEntries = Object.entries(replacements).sort(
      ([a], [b]) => b.length - a.length
    );

    for (const [original, fake] of sortedEntries) {
      if (!original || !fake) continue;
      // Store reverse mapping: fake → original
      tabMapping.set(fake, original);
      // Replace all occurrences
      anonymizedText = anonymizedText.split(original).join(fake);
    }

    // Persist mapping to storage
    await saveMappings();

    console.log(`[PII Shield] Found ${Object.keys(replacements).length} PII entities.`);
    return { anonymizedText, replacements, hasPII };

  } catch (err) {
    console.error('[PII Shield] Error during PII detection:', err);
    // Reset session on error so it gets recreated
    aiSession = null;
    return { anonymizedText: text, replacements: {}, hasPII: false };
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

  let result = text;
  // Sort by fake value length descending to avoid partial matches
  const sortedEntries = [...tabMapping.entries()].sort(
    ([a], [b]) => b.length - a.length
  );

  for (const [fake, original] of sortedEntries) {
    result = result.split(fake).join(original);
  }

  return result;
}

// ─── Storage ────────────────────────────────────────────────────────────────

async function saveMappings() {
  const serializable = {};
  for (const [tabId, map] of mappings) {
    serializable[tabId] = Object.fromEntries(map);
  }
  await chrome.storage.local.set({ piiMappings: serializable });
}

async function loadMappings() {
  const result = await chrome.storage.local.get('piiMappings');
  if (result.piiMappings) {
    for (const [tabId, obj] of Object.entries(result.piiMappings)) {
      mappings.set(tabId, new Map(Object.entries(obj)));
    }
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
          sendResponse({ anonymizedText: message.text, replacements: {}, hasPII: false });
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
