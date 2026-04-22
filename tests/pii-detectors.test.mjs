/**
 * Unit tests for deterministic PII detectors.
 *
 * Run with:   node tests/pii-detectors.test.mjs
 */

import assert from 'node:assert/strict';
import {
  createFallbackReplacement,
  detectDeterministicPII,
} from '../pii-detectors.js';

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

function categories(entities) {
  return entities.map(entity => entity.category);
}

section('detectDeterministicPII');

test('detects emails and produces stable fake addresses', () => {
  const text = 'Bitte max.mustermann@firma.de kontaktieren.';
  const entities = detectDeterministicPII(text);
  assert.deepEqual(categories(entities), ['email']);
  assert.equal(entities[0].original, 'max.mustermann@firma.de');
  assert.equal(entities[0].replacement, createFallbackReplacement('max.mustermann@firma.de', 'email'));
  assert.match(entities[0].replacement, /^person-[a-z0-9]+@example\.invalid$/);
});

test('detects valid IBANs and ignores invalid checksums', () => {
  const entities = detectDeterministicPII('IBAN DE89 3704 0044 0532 0130 00 ist korrekt.');
  assert.deepEqual(categories(entities), ['iban']);
  assert.match(entities[0].replacement, /^DE\d{2} \d{4} \d{4} \d{4} \d{4} \d{2}$/);

  const invalid = detectDeterministicPII('IBAN DE00 3704 0044 0532 0130 00 ist falsch.');
  assert.equal(invalid.length, 0);
});

test('detects credit cards with Luhn validation', () => {
  const entities = detectDeterministicPII('Karte 4111 1111 1111 1111.');
  assert.deepEqual(categories(entities), ['credit_card']);
  assert.equal(entities[0].original, '4111 1111 1111 1111');
  assert.match(entities[0].replacement, /^4\d{3} \d{4} \d{4} \d{4}$/);
});

test('detects IPv4 addresses', () => {
  const entities = detectDeterministicPII('Server 192.168.1.100 antwortet.');
  assert.deepEqual(categories(entities), ['ip_address']);
  assert.match(entities[0].replacement, /^203\.0\.113\.\d{1,3}$/);
});

test('detects phone numbers without double-detecting card numbers', () => {
  const entities = detectDeterministicPII('Tel: +49 170 1234567, Karte: 4111 1111 1111 1111.');
  assert.deepEqual(categories(entities), ['phone', 'credit_card']);
});

test('detects simple date formats', () => {
  const entities = detectDeterministicPII('Geboren am 15.03.1985.');
  assert.deepEqual(categories(entities), ['date']);
  assert.match(entities[0].replacement, /^\d{2}\.\d{2}\.1988$/);
});

test('deduplicates repeated originals', () => {
  const entities = detectDeterministicPII('a@b.de und a@b.de');
  assert.equal(entities.length, 1);
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
