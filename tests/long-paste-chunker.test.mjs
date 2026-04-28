/**
 * Unit tests for token-aware long-paste chunking helpers.
 */

import assert from 'node:assert/strict';
import {
  estimateChunkCharLimit,
  offsetChunkEntities,
  shouldMeasureChunk,
  splitChunkForRetry,
  splitTextIntoChunks,
} from '../long-paste-chunker.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${title}`);
}

section('estimateChunkCharLimit');

test('derives a conservative character limit from context quota', () => {
  assert.equal(
    estimateChunkCharLimit({
      contextWindow: 6144,
      contextUsage: 512,
      overheadTokens: 256,
      contextTargetRatio: 0.65,
      charsPerToken: 4,
      minChars: 1200,
      maxChars: 18000,
    }),
    13976
  );
});

test('falls back to a safe character limit when token APIs are absent', () => {
  assert.equal(
    estimateChunkCharLimit({ fallbackMaxChars: 8000, minChars: 1200, maxChars: 18000 }),
    8000
  );
});

section('splitTextIntoChunks');

test('prefers paragraph boundaries before hard limits', () => {
  const text = `${'A'.repeat(40)}\n\n${'B'.repeat(40)}\n\n${'C'.repeat(40)}`;
  const chunks = splitTextIntoChunks(text, 85, { minChars: 20, overlapChars: 0 });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].boundary, 'paragraph');
  assert.equal(chunks[0].text.endsWith('\n\n'), true);
  assert.equal(chunks[1].text.startsWith('C'), true);
});

test('adds overlap only when a chunk must break inside a word run', () => {
  const text = 'x'.repeat(180);
  const chunks = splitTextIntoChunks(text, 80, { minChars: 30, overlapChars: 10 });

  assert.equal(chunks[0].boundary, 'hard');
  assert.equal(chunks[1].start, chunks[0].end - 10);
});

test('marks near-limit chunks for measurement', () => {
  assert.equal(shouldMeasureChunk({ text: 'x'.repeat(86) }, 100, 0.85), true);
  assert.equal(shouldMeasureChunk({ text: 'x'.repeat(84) }, 100, 0.85), false);
});

section('retry and offsets');

test('splits oversized retry chunks into smaller pieces', () => {
  const chunk = {
    text: 'A sentence. '.repeat(100),
    start: 200,
    end: 200 + 'A sentence. '.repeat(100).length,
  };
  const pieces = splitChunkForRetry(chunk, { minChars: 120, overlapChars: 0 });

  assert.ok(Array.isArray(pieces));
  assert.ok(pieces.length > 1);
  assert.equal(pieces[0].start, 200);
  assert.equal(pieces.at(-1).end, chunk.end);
});

test('offsets chunk-local entity spans into full-text coordinates', () => {
  const entities = offsetChunkEntities(
    [{ original: 'max@test.de', category: 'email', start: 8, end: 19 }],
    { start: 120, end: 180 }
  );

  assert.deepEqual(entities[0], {
    original: 'max@test.de',
    category: 'email',
    start: 128,
    end: 139,
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
