/**
 * Unit tests for simple-mode masking helpers.
 */

import assert from 'node:assert/strict';
import {
  applyMasking,
  buildSimpleDisplaySummary,
  mapDetectorCategoryToSimpleCategory,
  mapOPFLabelToSimpleCategory,
  mergeMaskEntities,
  placeholderForCategory,
} from '../masking-engine.js';

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

section('placeholder mapping');

test('maps OPF labels to typed placeholders', () => {
  assert.equal(mapOPFLabelToSimpleCategory('private_person'), 'person');
  assert.equal(mapOPFLabelToSimpleCategory('private_email'), 'email');
  assert.equal(placeholderForCategory('person'), '<PRIVATE_PERSON>');
  assert.equal(placeholderForCategory('secret'), '<SECRET>');
});

test('maps deterministic categories into simple-mode categories', () => {
  assert.equal(mapDetectorCategoryToSimpleCategory('email'), 'email');
  assert.equal(mapDetectorCategoryToSimpleCategory('iban'), 'iban');
  assert.equal(mapDetectorCategoryToSimpleCategory('credit_card'), 'credit_card');
});

section('mergeMaskEntities');

test('prefers deterministic spans over overlapping model spans', () => {
  const merged = mergeMaskEntities(
    [{ source: 'deterministic', category: 'email', start: 21, end: 32 }],
    [{ source: 'model', category: 'person', start: 18, end: 32 }]
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'deterministic');
  assert.equal(merged[0].category, 'email');
});

section('applyMasking');

test('masks multiple spans atomically with typed placeholders', () => {
  const text = 'Kontakt: Max Mustermann, max@test.de';
  const nameStart = text.indexOf('Max Mustermann');
  const emailStart = text.indexOf('max@test.de');
  const masked = applyMasking(text, [
    { source: 'model', category: 'person', start: nameStart, end: nameStart + 'Max Mustermann'.length },
    { source: 'deterministic', category: 'email', start: emailStart, end: emailStart + 'max@test.de'.length },
  ]);

  assert.equal(masked, 'Kontakt: <PRIVATE_PERSON>, <PRIVATE_EMAIL>');
});

test('builds a simple display summary from merged spans', () => {
  const summary = buildSimpleDisplaySummary([
    { source: 'model', category: 'person', start: 0, end: 3 },
    { source: 'deterministic', category: 'email', start: 5, end: 8 },
  ]);

  assert.deepEqual(summary, {
    count: 2,
    categories: {
      person: 1,
      email: 1,
    },
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
