/**
 * Unit tests for the replacement engine.
 *
 * Run with:   node tests/replacement-engine.test.mjs
 *
 * These tests pin the behavior that matters for privacy: de-anonymization
 * must still fire when a chatbot uses only part of a fake name, or when the
 * name appears in an inflected form.
 */

import assert from 'node:assert/strict';
import {
  applyReplacements,
  buildReplacementEntries,
  findReplacementSpans,
} from '../replacement-engine.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ─── buildReplacementEntries ────────────────────────────────────────────────

section('buildReplacementEntries');

test('emits a single entry for a single value', () => {
  const entries = buildReplacementEntries(new Map([['foo', 'bar']]));
  assert.deepEqual(entries, [{ from: 'foo', to: 'bar' }]);
});

test('decomposes two-part names into per-component entries', () => {
  const entries = buildReplacementEntries(
    new Map([['Thomas Weber', 'Max Mustermann']])
  );
  const fromSet = new Set(entries.map(e => e.from));
  assert.ok(fromSet.has('Thomas Weber'));
  assert.ok(fromSet.has('Thomas'));
  assert.ok(fromSet.has('Weber'));
  const weber = entries.find(e => e.from === 'Weber');
  assert.equal(weber.to, 'Mustermann');
});

test('does not decompose when part counts differ', () => {
  const entries = buildReplacementEntries(
    new Map([['Thomas Weber', 'Max']])
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].from, 'Thomas Weber');
});

test('skips components shorter than 3 characters', () => {
  const entries = buildReplacementEntries(
    new Map([['Li Ma', 'Xu Ye']])
  );
  assert.equal(entries.length, 1);
});

test('sorts entries by from-length descending', () => {
  const entries = buildReplacementEntries(
    new Map([['Thomas Weber', 'Max Mustermann']])
  );
  for (let i = 1; i < entries.length; i++) {
    assert.ok(entries[i - 1].from.length >= entries[i].from.length);
  }
});

test('ignores empty keys or values', () => {
  const entries = buildReplacementEntries(
    new Map([['', 'x'], ['y', ''], ['ok', 'fine']])
  );
  assert.deepEqual(entries, [{ from: 'ok', to: 'fine' }]);
});

// ─── applyReplacements: exact-match path (non-word-like) ────────────────────

section('applyReplacements — exact match (emails, phones, IBANs)');

test('replaces an email exactly', () => {
  const out = applyReplacements('Mail me at a@b.de now.', [
    { from: 'a@b.de', to: 'x@y.de' },
  ]);
  assert.equal(out, 'Mail me at x@y.de now.');
});

test('replaces an IBAN across surrounding whitespace/punctuation', () => {
  const out = applyReplacements('IBAN: DE89370400440532013000.', [
    { from: 'DE89370400440532013000', to: 'DE11111111111111111111' },
  ]);
  assert.equal(out, 'IBAN: DE11111111111111111111.');
});

test('replaces a phone number containing +, spaces and hyphens', () => {
  const out = applyReplacements('Call +49 170 1234567 today', [
    { from: '+49 170 1234567', to: '+49 151 9876543' },
  ]);
  assert.equal(out, 'Call +49 151 9876543 today');
});

// ─── applyReplacements: word-boundary path (names) ──────────────────────────

section('applyReplacements — word boundary + inflection');

test('replaces a bare name', () => {
  const out = applyReplacements('Herr Weber kommt.', [
    { from: 'Weber', to: 'Mustermann' },
  ]);
  assert.equal(out, 'Herr Mustermann kommt.');
});

test('replaces a genitive inflection ("Webers" → "Mustermanns")', () => {
  const out = applyReplacements('Webers Vertrag wurde geprüft.', [
    { from: 'Weber', to: 'Mustermann' },
  ]);
  assert.equal(out, 'Mustermanns Vertrag wurde geprüft.');
});

test('handles German umlauts in both original and replacement', () => {
  const out = applyReplacements('Müllers Haus ist groß.', [
    { from: 'Müller', to: 'Schmidt' },
  ]);
  assert.equal(out, 'Schmidts Haus ist groß.');
});

test('does not match a name embedded inside a longer word', () => {
  const out = applyReplacements('Maximilian ist ein Name.', [
    { from: 'Max', to: 'Tim' },
  ]);
  assert.equal(out, 'Maximilian ist ein Name.');
});

test('replaces the same name multiple times', () => {
  const out = applyReplacements('Weber sagt: "Ich bin Weber."', [
    { from: 'Weber', to: 'Mustermann' },
  ]);
  assert.equal(out, 'Mustermann sagt: "Ich bin Mustermann."');
});

test('respects sort order so full name wins over last name', () => {
  const entries = buildReplacementEntries(
    new Map([['Thomas Weber', 'Max Mustermann']])
  );
  const out = applyReplacements('Thomas Weber und Weber.', entries);
  assert.equal(out, 'Max Mustermann und Mustermann.');
});

test('handles hyphenated words as word-like', () => {
  const out = applyReplacements('Die Firma Meyer-Schmidt sagt hallo.', [
    { from: 'Meyer-Schmidt', to: 'Muster-Firma' },
  ]);
  assert.equal(out, 'Die Firma Muster-Firma sagt hallo.');
});

test('does not incorrectly chain replacements (A→B then B→C)', () => {
  const out = applyReplacements('Weber und Mustermann.', [
    { from: 'Weber', to: 'Mustermann' },
    { from: 'Mustermann', to: 'Schmidt' },
  ]);
  assert.equal(out, 'Mustermann und Schmidt.');
});

test('does not cascade city replacements', () => {
  const out = applyReplacements('Berlin und München sind Städte.', [
    { from: 'Berlin', to: 'München' },
    { from: 'München', to: 'Köln' },
  ]);
  assert.equal(out, 'München und Köln sind Städte.');
});

test('prefers the longest overlapping match at the same position', () => {
  const out = applyReplacements('Thomas Weber unterschreibt.', [
    { from: 'Thomas', to: 'Max' },
    { from: 'Thomas Weber', to: 'Max Mustermann' },
  ]);
  assert.equal(out, 'Max Mustermann unterschreibt.');
});

// ─── findReplacementSpans ──────────────────────────────────────────────────

section('findReplacementSpans');

test('returns spans from the original text', () => {
  const spans = findReplacementSpans('Weber und Mustermann.', [
    { from: 'Weber', to: 'Mustermann' },
    { from: 'Mustermann', to: 'Schmidt' },
  ]);

  assert.deepEqual(spans, [
    { start: 0, end: 5, replacement: 'Mustermann', from: 'Weber' },
    { start: 10, end: 20, replacement: 'Schmidt', from: 'Mustermann' },
  ]);
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
