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
 * Find non-overlapping replacement spans in the original text. Word-like
 * values use Unicode-aware boundaries and preserve up to 2 trailing letters so
 * that German inflections ("Webers", "Müllern") are carried over.
 *
 * Matches are selected on the original input before anything is replaced. This
 * keeps replacements atomic: A -> B can never be transformed again by B -> C.
 *
 * @param {string} text
 * @param {{from: string, to: string}[]} entries
 * @returns {{start: number, end: number, replacement: string, from: string}[]}
 */
export function findReplacementSpans(text, entries) {
  const candidates = [];

  entries.forEach(({ from, to }, entryIndex) => {
    if (!from || !to) return;

    if (WORD_LIKE.test(from)) {
      const escaped = from.replace(REGEX_META, '\\$&');
      const re = new RegExp(
        `(?<=^|[^\\p{L}\\p{N}_])${escaped}(\\p{L}{0,2})(?=$|[^\\p{L}\\p{N}_])`,
        'gu'
      );
      for (const match of text.matchAll(re)) {
        candidates.push({
          start: match.index,
          end: match.index + match[0].length,
          replacement: to + (match[1] || ''),
          from,
          priority: entryIndex,
        });
      }
      return;
    }

    let start = text.indexOf(from);
    while (start !== -1) {
      candidates.push({
        start,
        end: start + from.length,
        replacement: to,
        from,
        priority: entryIndex,
      });
      start = text.indexOf(from, start + Math.max(from.length, 1));
    }
  });

  candidates.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lengthDiff = (b.end - b.start) - (a.end - a.start);
    if (lengthDiff !== 0) return lengthDiff;
    return a.priority - b.priority;
  });

  const selected = [];
  let lastEnd = -1;
  for (const candidate of candidates) {
    if (candidate.start < lastEnd) continue;
    selected.push(candidate);
    lastEnd = candidate.end;
  }

  return selected.map(({ start, end, replacement, from }) => ({
    start,
    end,
    replacement,
    from,
  }));
}

/**
 * Apply replacements to a text atomically based on spans selected from the
 * original input.
 */
export function applyReplacements(text, entries) {
  const spans = findReplacementSpans(text, entries);
  let result = text;

  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i];
    result = result.slice(0, span.start) + span.replacement + result.slice(span.end);
  }

  return result;
}
