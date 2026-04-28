/**
 * Conservative paste triage before the Reversible Mode LLM path.
 *
 * This module only bypasses the LLM for short, explicitly low-risk snippets or
 * for structured PII that deterministic detectors can fully protect. Anything
 * ambiguous falls back to the AI path.
 */

export const PASTE_TRIAGE_DECISIONS = Object.freeze({
  NEEDS_AI: 'needs_ai',
  SAFE_SKIP_AI: 'safe_skip_ai',
  DETERMINISTIC_ONLY: 'deterministic_only',
});

const MAX_BYPASS_CHARS = 600;
const MAX_BYPASS_LINES = 6;

const NAME_PARTICLES = new Set(['von', 'van', 'de', 'del', 'da', 'di', 'bin', 'al']);
const KNOWN_FIRST_NAMES = new Set([
  'alex', 'anna', 'avery', 'bram', 'camille', 'casey', 'charlie', 'chloe',
  'clara', 'daan', 'daniel', 'david', 'emily', 'emma', 'felix', 'hanna',
  'hannah', 'henry', 'jack', 'james', 'jan', 'jonas', 'jordan', 'julia',
  'kai', 'kim', 'laura', 'lea', 'lena', 'leon', 'lily', 'lou', 'lucas',
  'lukas', 'marie', 'max', 'mia', 'miles', 'moritz', 'noa', 'noah',
  'oliver', 'paul', 'robin', 'sam', 'sarah', 'simon', 'sophie', 'taylor',
  'thomas', 'tim', 'toni',
]);

const HONORIFIC_RE = /\b(?:herr|frau|mr\.?|mrs\.?|ms\.?|miss|dr\.?|prof\.?|monsieur|madame|señor|senor|señora|senora|signor|signora|dhr\.?|mevr\.?|mevrouw|heer)\b/iu;
const ADDRESS_RE = /\b(?:[A-ZÄÖÜ][\p{L}'’-]*\s+)?(?:straße|strasse|street|st\.|road|rd\.|avenue|ave\.|weg|allee|platz|gasse|boulevard|rue|via|calle|laan|straat)\b|\b\d{4,5}\s+[A-ZÄÖÜ][\p{L}'’-]+|\b\d{4}\s?[A-Z]{2}\s+[A-Z][\p{L}'’-]+|\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/iu;
const COMPANY_RE = /\b[\p{L}0-9&.'’-]+\s+(?:GmbH(?:\s*&\s*Co\.\s*KG)?|UG\s*\(haftungsbeschränkt\)|AG|KG|OHG|LLC|Inc\.?|Ltd\.?|Corp\.?|Corporation|S\.?A\.?R\.?L\.?|SARL|SAS|S\.?L\.?|S\.?r\.?l\.?|SpA|BV|NV)\b/iu;
const ID_CONTEXT_RE = /\b(?:patient|kunde|kundin|customer|client|mandant|kontakt|contact|adresse|address|anschrift|vertrag|contract|rechnung|invoice|account|konto|policy|claim|case|ticket|dob|birth|birthday|born|geboren|geburtsdatum|passport|reisepass|ausweis|driver'?s?\s+license|führerschein|fuehrerschein|medical\s+record|krankenakte|versicherungsnummer|kundennummer|steuer(?:-|\s*)id|tax\s+id|ssn|national\s+id)\b/iu;
const ID_VALUE_RE = /\b(?:id|nr\.?|nummer|number|record)\s*[:#-]?\s*[A-Z0-9][A-Z0-9/-]{2,}\b/iu;

const SAFE_EN_RE = /^(?:(?:please|kindly)\s+)?(?:summari[sz]e|translate|rewrite|explain|improve|shorten|proofread|format|fix|check)\b|^(?:can|could)\s+you\b.{0,120}\b(?:summari[sz]e|translate|rewrite|explain|improve|shorten|proofread|format|grammar|spelling)\b/iu;
const SAFE_DE_RE = /^(?:bitte\s+)?(?:kurz\s+)?(?:zusammenfassen|übersetzen|uebersetzen|umformulieren|erklären|erklaeren|verbessern|korrigieren|kürzen|kuerzen|prüfen|pruefen)\b|^(?:kannst|könntest|koenntest)\s+du\b.{0,120}\b(?:zusammenfassen|übersetzen|uebersetzen|umformulieren|erklären|erklaeren|verbessern|korrigieren|kürzen|kuerzen|prüfen|pruefen)\b/iu;
const SAFE_CONVERSATIONAL_RE = /^(?:hello|hi|hey|thanks|thank you|danke|ok|okay|ja|nein)\b/iu;

export function triageReversiblePaste(text, deterministicEntities = []) {
  const source = String(text || '');
  const trimmed = source.trim();
  const lineCount = trimmed ? trimmed.split(/\r\n|\r|\n/).length : 0;
  const charCount = trimmed.length;
  const entities = Array.isArray(deterministicEntities) ? deterministicEntities : [];

  if (!trimmed) {
    return decision(PASTE_TRIAGE_DECISIONS.SAFE_SKIP_AI, 'empty');
  }

  if (charCount > MAX_BYPASS_CHARS || lineCount > MAX_BYPASS_LINES) {
    return decision(PASTE_TRIAGE_DECISIONS.NEEDS_AI, 'too_large_for_bypass');
  }

  const openText = blankEntityRanges(source, entities);
  const riskSignals = detectOpenRiskSignals(openText);

  if (riskSignals.length > 0) {
    return decision(PASTE_TRIAGE_DECISIONS.NEEDS_AI, 'open_semantic_risk', riskSignals);
  }

  if (entities.length > 0) {
    return decision(PASTE_TRIAGE_DECISIONS.DETERMINISTIC_ONLY, 'structured_pii_only');
  }

  if (isExplicitlyLowRiskSnippet(trimmed)) {
    return decision(PASTE_TRIAGE_DECISIONS.SAFE_SKIP_AI, 'explicit_low_risk_snippet');
  }

  return decision(PASTE_TRIAGE_DECISIONS.NEEDS_AI, 'not_explicitly_low_risk');
}

function decision(value, reason, riskSignals = []) {
  return {
    decision: value,
    reason,
    riskSignals,
  };
}

function blankEntityRanges(text, entities) {
  const chars = String(text || '').split('');

  for (const entity of entities) {
    const start = Number.isInteger(entity?.start) ? entity.start : -1;
    const end = Number.isInteger(entity?.end) ? entity.end : -1;
    if (start < 0 || end <= start || end > chars.length) continue;
    for (let index = start; index < end; index++) {
      chars[index] = ' ';
    }
  }

  return chars.join('');
}

function detectOpenRiskSignals(text) {
  const signals = [];

  addSignal(signals, 'honorific', HONORIFIC_RE.test(text));
  addSignal(signals, 'address', ADDRESS_RE.test(text));
  addSignal(signals, 'company', COMPANY_RE.test(text));
  addSignal(signals, 'id_context', ID_CONTEXT_RE.test(text) || ID_VALUE_RE.test(text));
  addSignal(signals, 'known_first_name', hasKnownFirstName(text));
  addSignal(signals, 'multi_part_name', hasMultiPartName(text));
  addSignal(signals, 'mid_sentence_capitalized_token', hasMidSentenceCapitalizedToken(text));

  return signals;
}

function addSignal(signals, name, active) {
  if (active) signals.push(name);
}

function hasKnownFirstName(text) {
  const tokenRe = /\b[\p{L}'’-]{2,}\b/gu;
  for (const match of text.matchAll(tokenRe)) {
    const token = stripToken(match[0]).toLocaleLowerCase();
    if (KNOWN_FIRST_NAMES.has(token)) return true;
  }
  return false;
}

function hasMultiPartName(text) {
  const tokenRe = /\b[\p{L}'’-]{2,}\b/gu;
  const tokens = [...text.matchAll(tokenRe)].map((match) => ({
    token: stripToken(match[0]),
    index: match.index,
  }));

  for (let index = 0; index < tokens.length - 1; index++) {
    const current = tokens[index];
    const next = tokens[index + 1];
    const between = text.slice(current.index + current.token.length, next.index);
    if (!/^\s+$/.test(between)) continue;
    if (isTitleCaseNamePart(current.token) && isNameContinuation(next.token)) return true;
  }

  return false;
}

function hasMidSentenceCapitalizedToken(text) {
  const tokenRe = /\b[\p{Lu}][\p{L}'’-]{1,}\b/gu;
  for (const match of text.matchAll(tokenRe)) {
    const token = stripToken(match[0]);
    if (!token || isAllCaps(token)) continue;
    if (isSentenceStart(text, match.index)) continue;
    return true;
  }
  return false;
}

function isNameContinuation(token) {
  const normalized = stripToken(token);
  return isTitleCaseNamePart(normalized) || NAME_PARTICLES.has(normalized.toLocaleLowerCase());
}

function isTitleCaseNamePart(token) {
  return /^[\p{Lu}][\p{L}'’-]{1,}$/u.test(token) && !isAllCaps(token);
}

function isAllCaps(token) {
  return token.toLocaleUpperCase() === token && token.toLocaleLowerCase() !== token;
}

function isSentenceStart(text, index) {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const char = text[cursor];
    if (/[\s"'([{]/.test(char)) continue;
    return /[.!?。！？:;\n\r]/.test(char);
  }
  return true;
}

function stripToken(token) {
  return String(token || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function isExplicitlyLowRiskSnippet(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return SAFE_EN_RE.test(normalized)
    || SAFE_DE_RE.test(normalized)
    || SAFE_CONVERSATIONAL_RE.test(normalized);
}
