/**
 * Pure helpers for the non-reversible Simple Mode.
 *
 * The engine merges deterministic structured detections with OPF model spans
 * and replaces selected spans with typed placeholders in one atomic pass.
 */

export const SIMPLE_MODE_PLACEHOLDERS = Object.freeze({
  person: '<PRIVATE_PERSON>',
  email: '<PRIVATE_EMAIL>',
  phone: '<PRIVATE_PHONE>',
  address: '<PRIVATE_ADDRESS>',
  date: '<PRIVATE_DATE>',
  url: '<PRIVATE_URL>',
  account: '<PRIVATE_ACCOUNT>',
  iban: '<PRIVATE_IBAN>',
  credit_card: '<PRIVATE_CARD>',
  ip: '<PRIVATE_IP>',
  secret: '<SECRET>',
});

const DETECTOR_CATEGORY_MAP = Object.freeze({
  name: 'person',
  email: 'email',
  phone: 'phone',
  address: 'address',
  date: 'date',
  national_id: 'secret',
  credit_card: 'credit_card',
  iban: 'iban',
  ip_address: 'ip',
  company: 'secret',
  passport: 'secret',
  driver_license: 'secret',
  medical_record: 'secret',
  other: 'secret',
});

const OPF_LABEL_MAP = Object.freeze({
  account_number: 'account',
  private_address: 'address',
  private_email: 'email',
  private_person: 'person',
  private_phone: 'phone',
  private_url: 'url',
  private_date: 'date',
  secret: 'secret',
});

function sourcePriority(source) {
  switch (source) {
    case 'deterministic': return 0;
    case 'model': return 1;
    default: return 2;
  }
}

function spansOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function normalizeRange(entity) {
  const start = Number(entity?.start);
  const end = Number(entity?.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    return null;
  }
  return { start, end };
}

export function mapDetectorCategoryToSimpleCategory(category) {
  return DETECTOR_CATEGORY_MAP[category] || null;
}

export function mapOPFLabelToSimpleCategory(label) {
  return OPF_LABEL_MAP[label] || null;
}

export function placeholderForCategory(category) {
  return SIMPLE_MODE_PLACEHOLDERS[category] || SIMPLE_MODE_PLACEHOLDERS.secret;
}

export function normalizeMaskEntity(entity) {
  const range = normalizeRange(entity);
  if (!range) return null;

  const category = String(entity?.category || '').trim();
  if (!category) return null;

  return {
    ...entity,
    category,
    source: entity?.source || 'unknown',
    start: range.start,
    end: range.end,
  };
}

export function mergeMaskEntities(...groups) {
  const candidates = groups
    .flat()
    .map(normalizeMaskEntity)
    .filter(Boolean)
    .sort((a, b) => {
      const priorityDiff = sourcePriority(a.source) - sourcePriority(b.source);
      if (priorityDiff !== 0) return priorityDiff;
      if (a.start !== b.start) return a.start - b.start;
      const lengthDiff = (b.end - b.start) - (a.end - a.start);
      if (lengthDiff !== 0) return lengthDiff;
      return a.category.localeCompare(b.category);
    });

  const selected = [];
  for (const candidate of candidates) {
    if (selected.some(existing => spansOverlap(existing, candidate))) continue;
    selected.push(candidate);
  }

  selected.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
  });

  return selected;
}

export function applyMasking(text, entities) {
  const spans = mergeMaskEntities(entities);
  let result = text;

  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i];
    result = result.slice(0, span.start)
      + placeholderForCategory(span.category)
      + result.slice(span.end);
  }

  return result;
}

export function summarizeSimpleCategories(entities) {
  const summary = {};
  for (const entity of mergeMaskEntities(entities)) {
    summary[entity.category] = (summary[entity.category] || 0) + 1;
  }
  return summary;
}

export function buildSimpleDisplaySummary(entities) {
  const merged = mergeMaskEntities(entities);
  return {
    count: merged.length,
    categories: summarizeSimpleCategories(merged),
  };
}
