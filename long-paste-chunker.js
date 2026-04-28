/**
 * Helpers for splitting long paste payloads into context-budget-friendly
 * chunks. The helpers are pure so unit tests can exercise the sizing and
 * boundary behavior outside the extension runtime.
 */

export const DEFAULT_LONG_PASTE_CHUNK_OPTIONS = Object.freeze({
  fallbackMaxChars: 8000,
  minChars: 1200,
  maxChars: 18000,
  charsPerToken: 4,
  contextTargetRatio: 0.65,
  nearLimitRatio: 0.85,
  overlapChars: 160,
});

function finitePositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function estimateChunkCharLimit({
  contextWindow,
  inputQuota,
  contextUsage = 0,
  overheadTokens = 0,
  fallbackMaxChars = DEFAULT_LONG_PASTE_CHUNK_OPTIONS.fallbackMaxChars,
  minChars = DEFAULT_LONG_PASTE_CHUNK_OPTIONS.minChars,
  maxChars = DEFAULT_LONG_PASTE_CHUNK_OPTIONS.maxChars,
  charsPerToken = DEFAULT_LONG_PASTE_CHUNK_OPTIONS.charsPerToken,
  contextTargetRatio = DEFAULT_LONG_PASTE_CHUNK_OPTIONS.contextTargetRatio,
} = {}) {
  const quota = finitePositiveNumber(contextWindow) || finitePositiveNumber(inputQuota);
  if (!quota) return clamp(fallbackMaxChars, minChars, maxChars);

  const used = Math.max(0, Number.isFinite(contextUsage) ? contextUsage : 0);
  const overhead = Math.max(0, Number.isFinite(overheadTokens) ? overheadTokens : 0);
  const freeTokens = Math.max(0, quota - used - overhead);
  const targetTokens = Math.floor(freeTokens * contextTargetRatio);

  if (targetTokens <= 0) return minChars;
  return clamp(Math.floor(targetTokens * charsPerToken), minChars, maxChars);
}

function lastIndexAfter(text, pattern, start, end) {
  const slice = text.slice(start, end);
  let match;
  let last = -1;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(slice))) {
    last = start + match.index + match[0].length;
  }
  return last;
}

function findBoundary(text, start, targetEnd, minEnd) {
  const paragraph = text.lastIndexOf('\n\n', targetEnd);
  if (paragraph >= minEnd) return { end: paragraph + 2, kind: 'paragraph' };

  const newline = text.lastIndexOf('\n', targetEnd);
  if (newline >= minEnd) return { end: newline + 1, kind: 'line' };

  const sentence = lastIndexAfter(text, /[.!?。！？][)"'\]\u201d\u2019]*\s+/g, start, targetEnd);
  if (sentence >= minEnd) return { end: sentence, kind: 'sentence' };

  const whitespace = text.lastIndexOf(' ', targetEnd);
  if (whitespace >= minEnd) return { end: whitespace + 1, kind: 'word' };

  return { end: targetEnd, kind: 'hard' };
}

export function splitTextIntoChunks(text, maxChars, options = {}) {
  const source = String(text || '');
  const opts = {
    ...DEFAULT_LONG_PASTE_CHUNK_OPTIONS,
    ...options,
  };
  const limit = Math.max(1, Math.floor(maxChars || opts.fallbackMaxChars));
  const minChars = Math.max(1, Math.min(opts.minChars, limit));
  const chunks = [];
  let cursor = 0;

  while (cursor < source.length) {
    const remaining = source.length - cursor;
    if (remaining <= limit) {
      chunks.push({
        text: source.slice(cursor),
        start: cursor,
        end: source.length,
        boundary: 'end',
      });
      break;
    }

    const targetEnd = cursor + limit;
    const minEnd = cursor + Math.min(minChars, Math.floor(limit * 0.5));
    const boundary = findBoundary(source, cursor, targetEnd, minEnd);
    const end = Math.max(cursor + 1, Math.min(boundary.end, source.length));

    chunks.push({
      text: source.slice(cursor, end),
      start: cursor,
      end,
      boundary: boundary.kind,
    });

    const shouldOverlap = boundary.kind === 'word' || boundary.kind === 'hard';
    const overlap = shouldOverlap ? Math.max(0, Math.min(opts.overlapChars, end - cursor - 1)) : 0;
    const nextCursor = end - overlap;
    cursor = nextCursor > cursor ? nextCursor : end;
  }

  return chunks.filter((chunk) => chunk.end > chunk.start);
}

export function shouldMeasureChunk(chunk, charLimit, nearLimitRatio = DEFAULT_LONG_PASTE_CHUNK_OPTIONS.nearLimitRatio) {
  const length = String(chunk?.text || '').length;
  if (!length || !Number.isFinite(charLimit) || charLimit <= 0) return false;
  return length >= charLimit * nearLimitRatio;
}

export function splitChunkForRetry(chunk, options = {}) {
  const opts = {
    ...DEFAULT_LONG_PASTE_CHUNK_OPTIONS,
    ...options,
    overlapChars: 0,
  };
  const length = (chunk?.end || 0) - (chunk?.start || 0);
  if (!chunk || length <= Math.max(2, opts.minChars)) return null;

  const targetLimit = Math.max(opts.minChars, Math.ceil(length / 2));
  const pieces = splitTextIntoChunks(chunk.text, targetLimit, opts)
    .map((piece) => ({
      ...piece,
      start: chunk.start + piece.start,
      end: chunk.start + piece.end,
      text: chunk.text.slice(piece.start, piece.end),
      retryDepth: (chunk.retryDepth || 0) + 1,
    }))
    .filter((piece) => piece.end > piece.start);

  return pieces.length > 1 ? pieces : null;
}

export function offsetChunkEntities(entities, chunk) {
  return entities.map((entity) => ({
    ...entity,
    start: Number.isInteger(entity?.start) ? chunk.start + entity.start : entity.start,
    end: Number.isInteger(entity?.end) ? chunk.start + entity.end : entity.end,
  }));
}
