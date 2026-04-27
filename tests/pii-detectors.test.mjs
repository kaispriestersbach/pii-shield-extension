/**
 * Unit tests for deterministic PII detectors.
 *
 * Run with:   node tests/pii-detectors.test.mjs
 */

import assert from 'node:assert/strict';
import {
  SUPPORTED_BENCHMARK_LOCALES,
  canonicalPersonNameKey,
  createContextAwareReplacement,
  createFallbackReplacement,
  detectDeterministicPII,
  normalizePersonNameOriginal,
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

section('context-aware replacements');

test('documents benchmark-backed UI locales centrally', () => {
  assert.deepEqual(SUPPORTED_BENCHMARK_LOCALES, ['en', 'de', 'fr', 'es', 'it', 'nl']);
});

test('keeps phone country code when present', () => {
  const replacement = createFallbackReplacement('+49 170 1234567', 'phone');
  assert.match(replacement, /^\+49/);
});

test('keeps female honorifics and returns a plausible female name', () => {
  const replacement = createFallbackReplacement('Frau Anna Schmidt', 'name');
  assert.match(
    replacement,
    /^Frau (Anna|Sophie|Lena|Lea|Julia|Clara|Emma|Laura|Marie|Hanna) [A-ZÄÖÜ][\p{L}-]+$/u
  );
});

test('normalizes person names out of image alt-text style suffixes', () => {
  assert.equal(
    normalizePersonNameOriginal('Kai spriestersbach 2026 square'),
    'Kai spriestersbach'
  );
  assert.equal(normalizePersonNameOriginal('Kai Spriestersbach.png'), 'Kai Spriestersbach');
  assert.equal(normalizePersonNameOriginal('Kai Spriestersbach SEO'), 'Kai Spriestersbach');
  assert.equal(
    canonicalPersonNameKey('Kai spriestersbach 2026 square'),
    canonicalPersonNameKey('Kai Spriestersbach')
  );
});

test('uses the same fake name for case-only variants and alt-text suffixes', () => {
  const canonical = createFallbackReplacement('Kai Spriestersbach', 'name');
  assert.equal(createFallbackReplacement('Kai spriestersbach', 'name'), canonical);
  assert.equal(createFallbackReplacement('Kai spriestersbach 2026 square', 'name'), canonical);
  assert.doesNotMatch(canonical, /\b(?:CARTER|bennett|2026|square)\b/);
});

test('keeps addresses in Germany when the original is in Germany', () => {
  const replacement = createFallbackReplacement(
    'Musterstraße 12, 10115 Berlin, Deutschland',
    'address'
  );
  assert.match(replacement, /Deutschland/);
  assert.doesNotMatch(replacement, /Austria|Österreich|USA|United Kingdom|Schweiz/);
});

test('keeps the company legal suffix', () => {
  const replacement = createFallbackReplacement('Beispiel Holding GmbH', 'company');
  assert.match(replacement, /\bGmbH$/);
});

test('uses Dutch replacement data for Dutch companies and addresses', () => {
  const company = createFallbackReplacement('Voorbeeld Holding BV', 'company');
  assert.match(company, /\bBV$/);
  assert.match(company, /^(Noorddam|Rijnzicht|Zonhoven|Waterkant|Lindenhof|Brugstede) BV$/);

  const address = createFallbackReplacement('Damstraat 12, 1012 AB Amsterdam, Nederland', 'address');
  assert.match(address, /Nederland/);
  assert.match(address, /\b\d{4}\s?[A-Z]{2}\b/);
});

test('keeps passport-like formats readable', () => {
  const replacement = createFallbackReplacement('C01X00T47', 'passport');
  assert.match(replacement, /^[A-Z]\d{2}[A-Z]\d{2}[A-Z]\d{2}$/);
});

test('uses a provided suggestion only for uncategorized other-values', () => {
  const replacement = createContextAwareReplacement('Projekt Adler', 'other', 'Projekt Nova');
  assert.equal(replacement, 'Projekt Nova');
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
