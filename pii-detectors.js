/**
 * Deterministic PII detectors and fake-value generators.
 *
 * These do not replace Gemini Nano. They cover high-signal structured PII so
 * common values remain protected even if the LLM misses them or returns an
 * empty structured response.
 */

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_RE = /\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}\b/gi;
const DATE_RE = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-](?:\d{2}|\d{4}))\b/g;
const PHONE_RE = /(?:\+?\d{1,3}[\s./-]?)?(?:\(?\d{2,5}\)?[\s./-]?){2,}\d{2,}/g;

const CATEGORY_LABELS = new Set([
  'email',
  'iban',
  'credit_card',
  'phone',
  'ip_address',
  'date',
  'name',
  'address',
  'company',
  'national_id',
  'passport',
  'driver_license',
  'medical_record',
  'other',
]);

const DIGIT_STREAM = '5117064928351047283946501928374650918273645546372819';

export function isKnownCategory(category) {
  return CATEGORY_LABELS.has(category);
}

export function detectDeterministicPII(text) {
  const entities = [];
  const occupied = [];
  const seen = new Set();

  scan(text, EMAIL_RE, 'email', isValidEmail, entities, occupied, seen);
  scan(text, IBAN_RE, 'iban', isValidIban, entities, occupied, seen);
  scan(text, CARD_RE, 'credit_card', isValidCreditCard, entities, occupied, seen);
  scan(text, IPV4_RE, 'ip_address', isValidIPv4, entities, occupied, seen);
  scan(text, IPV6_RE, 'ip_address', isValidIPv6, entities, occupied, seen);
  scan(text, DATE_RE, 'date', isValidDateValue, entities, occupied, seen);
  scan(text, PHONE_RE, 'phone', isValidPhone, entities, occupied, seen);

  return entities.sort((a, b) => a.start - b.start);
}

export function createFallbackReplacement(original, category) {
  switch (category) {
    case 'email':
      return `person-${hashString(original).slice(0, 6)}@example.invalid`;
    case 'iban':
      return formatIbanLike(original, makeGermanIban(original));
    case 'credit_card':
      return formatDigitsLike(original, makeLuhnNumber(original));
    case 'phone':
      return formatDigitsLike(original, makePhoneDigits(original), { preserveLeadingPlus: true });
    case 'ip_address':
      return original.includes(':') ? makeIPv6(original) : makeIPv4(original);
    case 'date':
      return makeDate(original);
    default:
      return `Redacted-${hashString(original).slice(0, 6)}`;
  }
}

function scan(text, regex, category, validator, entities, occupied, seen) {
  regex.lastIndex = 0;

  for (const match of text.matchAll(regex)) {
    const original = match[0].trim();
    const start = match.index + match[0].indexOf(original);
    const end = start + original.length;
    const key = `${category}:${original}`;

    if (seen.has(key)) continue;
    if (!validator(original)) continue;
    if (overlapsAny(start, end, occupied)) continue;

    seen.add(key);
    occupied.push({ start, end });
    entities.push({
      original,
      replacement: createFallbackReplacement(original, category),
      category,
      source: 'deterministic',
      start,
      end,
      confidence: 1,
    });
  }
}

function overlapsAny(start, end, ranges) {
  return ranges.some(range => start < range.end && end > range.start);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidIban(value) {
  const compact = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  return mod97(ibanToNumeric(compact.slice(4) + compact.slice(0, 4))) === 1;
}

function isValidCreditCard(value) {
  const digits = onlyDigits(value);
  if (digits.length < 13 || digits.length > 19) return false;
  return luhnValid(digits);
}

function isValidIPv4(value) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

function isValidIPv6(value) {
  if (!value.includes(':')) return false;
  if (value.includes('::')) {
    const [left, right] = value.split('::');
    const leftParts = left ? left.split(':') : [];
    const rightParts = right ? right.split(':') : [];
    return leftParts.length + rightParts.length < 8 &&
      [...leftParts, ...rightParts].every(isIPv6Part);
  }
  const parts = value.split(':');
  return parts.length === 8 && parts.every(isIPv6Part);
}

function isIPv6Part(part) {
  return /^[A-Fa-f0-9]{1,4}$/.test(part);
}

function isValidDateValue(value) {
  const parsed = parseDate(value);
  if (!parsed) return false;
  const { day, month, year } = parsed;
  if (year < 1900 || year > 2099) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function isValidPhone(value) {
  const digits = onlyDigits(value);
  if (digits.length < 7 || digits.length > 15) return false;
  if (/^\d+$/.test(value.replace(/[\s./()+-]/g, '')) && luhnValid(digits)) return false;
  return /[\s./()+-]/.test(value) || value.startsWith('+');
}

function hashString(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function numericSeed(value) {
  return parseInt(hashString(value), 36);
}

function onlyDigits(value) {
  return value.replace(/\D/g, '');
}

function ibanToNumeric(value) {
  return value.toUpperCase().replace(/[A-Z]/g, char => String(char.charCodeAt(0) - 55));
}

function mod97(value) {
  let remainder = 0;
  for (const char of value) {
    remainder = (remainder * 10 + Number(char)) % 97;
  }
  return remainder;
}

function makeGermanIban(original) {
  const bankCode = '50010517';
  const account = String(numericSeed(original) % 10000000000).padStart(10, '0');
  const bban = `${bankCode}${account}`;
  const checksum = String(98 - mod97(`${bban}${ibanToNumeric('DE00')}`)).padStart(2, '0');
  return `DE${checksum}${bban}`;
}

function formatIbanLike(original, compactFake) {
  if (/\s/.test(original)) {
    return compactFake.match(/.{1,4}/g).join(' ');
  }
  return compactFake;
}

function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function makeLuhnNumber(original) {
  const length = Math.min(Math.max(onlyDigits(original).length, 13), 19);
  const seed = String(numericSeed(original)).padEnd(length, '0');
  let body = `4${seed}`.slice(0, length - 1);

  for (let digit = 0; digit <= 9; digit++) {
    const candidate = `${body}${digit}`;
    if (luhnValid(candidate)) return candidate;
  }

  body = body.slice(0, -1) + '0';
  return `${body}0`;
}

function makePhoneDigits(original) {
  const length = onlyDigits(original).length;
  const seed = String(numericSeed(original));
  return DIGIT_STREAM.concat(seed).repeat(2).slice(0, length);
}

function formatDigitsLike(original, digits, options = {}) {
  let index = 0;
  let formatted = '';

  for (const char of original) {
    if (/\d/.test(char)) {
      formatted += digits[index] || '0';
      index++;
    } else {
      formatted += char;
    }
  }

  if (options.preserveLeadingPlus && original.startsWith('+') && !formatted.startsWith('+')) {
    return `+${formatted}`;
  }

  return formatted;
}

function makeIPv4(original) {
  return `203.0.113.${(numericSeed(original) % 254) + 1}`;
}

function makeIPv6(original) {
  return `2001:db8::${(numericSeed(original) % 65535).toString(16)}`;
}

function parseDate(value) {
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      order: 'ymd',
      separator: '-',
    };
  }

  match = value.match(/^(\d{1,2})([./-])(\d{1,2})\2(\d{2}|\d{4})$/);
  if (!match) return null;

  const rawYear = Number(match[4]);
  return {
    day: Number(match[1]),
    month: Number(match[3]),
    year: rawYear < 100 ? 1900 + rawYear : rawYear,
    shortYear: match[4].length === 2,
    order: 'dmy',
    separator: match[2],
  };
}

function makeDate(original) {
  const parsed = parseDate(original);
  const day = String((numericSeed(original) % 27) + 1).padStart(2, '0');
  const month = String((numericSeed(`${original}:month`) % 12) + 1).padStart(2, '0');
  const year = parsed?.shortYear ? '88' : '1988';

  if (parsed?.order === 'ymd') {
    return `${year}-${month}-${day}`;
  }

  const separator = parsed?.separator || '.';
  return `${day}${separator}${month}${separator}${year}`;
}
