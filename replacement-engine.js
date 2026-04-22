/**
 * PII Shield – Replacement Engine
 *
 * Pure functions extracted into a module so they can be unit-tested in Node
 * independently of Chrome APIs. Used by both the background service worker
 * (anonymization + de-anonymization) and the test suite under `tests/`.
 */

const WORD_LIKE = /^[\p{L}\p{N}\s\-]+$/u;
const NAME_PART = /^[\p{L}\-]+$/u;
const REGEX_META = /[.*+?^${}()|[\]\\]/g;

/**
 * Build a flat list of replacement entries from a Map<from, to>.
 * Multi-word name-like values are additionally emitted as per-component
 * mappings so a response mentioning only part of a name still matches.
 * Results are sorted by `from` length descending so longer matches win.
 */
export function buildReplacementEntries(map) {
  const entries = [];
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
  entries.sort((a, b) => b.from.length - a.from.length);
  return entries;
}

/**
 * Apply replacements to a text. Word-like values (letters/hyphens) use a
 * Unicode-aware word boundary and preserve up to 2 trailing letters so that
 * German inflections ("Webers", "Müllern") are carried over to the replacement.
 * Everything else (emails, phone numbers, IBANs) uses exact substring match.
 */
export function applyReplacements(text, entries) {
  let result = text;
  for (const { from, to } of entries) {
    if (WORD_LIKE.test(from)) {
      const escaped = from.replace(REGEX_META, '\\$&');
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
