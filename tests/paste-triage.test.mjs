/**
 * Unit tests for conservative paste triage.
 *
 * Run with:   node tests/paste-triage.test.mjs
 */

import assert from 'node:assert/strict';
import { detectDeterministicPII } from '../pii-detectors.js';
import {
  PASTE_TRIAGE_DECISIONS,
  triageReversiblePaste,
} from '../paste-triage.js';

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

function decisionFor(text) {
  return triageReversiblePaste(text, detectDeterministicPII(text)).decision;
}

function assertDecision(text, expected) {
  assert.equal(decisionFor(text), expected);
}

console.log('\ntriageReversiblePaste');

test('allows explicitly low-risk short prompts to skip AI', () => {
  assertDecision('Please summarize this.', PASTE_TRIAGE_DECISIONS.SAFE_SKIP_AI);
  assertDecision('Bitte kurz zusammenfassen', PASTE_TRIAGE_DECISIONS.SAFE_SKIP_AI);
  assertDecision('Hello, how are you today? This is a long sentence.', PASTE_TRIAGE_DECISIONS.SAFE_SKIP_AI);
});

test('does not skip AI for names or name-like text', () => {
  assertDecision('Max Mustermann', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
  assertDecision('Kai Spriestersbach', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
  assertDecision('Herr Max Mustermann', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
  assertDecision('Please ask Alex to summarize this.', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
});

test('does not skip AI for addresses, companies, or contextual IDs', () => {
  assertDecision('Musterstraße 12', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
  assertDecision('10115 Berlin', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
  assertDecision('Beispiel GmbH', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
  assertDecision('Patient ID A-12345', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
  assertDecision('Kunde: Alex Weber', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
});

test('allows deterministic-only handling for isolated structured PII', () => {
  assertDecision('Email: max@test.de', PASTE_TRIAGE_DECISIONS.DETERMINISTIC_ONLY);
  assertDecision('Tel: +49 170 1234567', PASTE_TRIAGE_DECISIONS.DETERMINISTIC_ONLY);
  assertDecision('IBAN DE89 3704 0044 0532 0130 00', PASTE_TRIAGE_DECISIONS.DETERMINISTIC_ONLY);
  assertDecision('Card 4111 1111 1111 1111', PASTE_TRIAGE_DECISIONS.DETERMINISTIC_ONLY);
});

test('keeps contextual structured PII on the AI path', () => {
  assertDecision('Contact max@test.de before sending the final answer.', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
  assertDecision('Customer phone +49 170 1234567', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
  assertDecision('Born 15.03.1985', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
});

test('keeps larger or ambiguous text on the AI path', () => {
  assertDecision('Please review this paragraph carefully. '.repeat(30), PASTE_TRIAGE_DECISIONS.NEEDS_AI);
  assertDecision('The meeting went well and the next step is unclear.', PASTE_TRIAGE_DECISIONS.NEEDS_AI);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
