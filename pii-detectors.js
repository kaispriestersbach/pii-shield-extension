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
const UPPER_STREAM = 'QWERTYUPASDFGHJKLZXCVBNM';
const LOWER_STREAM = UPPER_STREAM.toLowerCase();
const NAME_PARTICLES = new Set(['von', 'van', 'de', 'del', 'da', 'di', 'bin', 'al']);
const COUNTRY_CALLING_CODES = [
  '998', '995', '994', '977', '976', '975', '974', '973', '972', '971', '386',
  '385', '372', '370', '359', '358', '356', '354', '353', '352', '351', '234',
  '91', '90', '86', '82', '81', '65', '64', '61', '55', '54', '52', '49', '48',
  '47', '46', '45', '44', '43', '41', '39', '34', '33', '32', '31', '30', '27',
  '20', '7', '1',
];
const NAME_DATA = {
  de: {
    maleFirst: ['Max', 'Jonas', 'Leon', 'Felix', 'Paul', 'Lukas', 'Simon', 'David', 'Tim', 'Jan', 'Moritz', 'Thomas'],
    femaleFirst: ['Anna', 'Sophie', 'Lena', 'Lea', 'Julia', 'Clara', 'Emma', 'Laura', 'Marie', 'Hanna', 'Sarah'],
    neutralFirst: ['Alex', 'Robin', 'Sam', 'Toni', 'Kim'],
    last: ['Schneider', 'Fischer', 'Weber', 'Meyer', 'Becker', 'Hoffmann', 'Schäfer', 'Koch', 'Bauer', 'Klein'],
  },
  en: {
    maleFirst: ['James', 'Oliver', 'Henry', 'Lucas', 'Daniel', 'Ethan', 'Jack', 'Noah', 'Samuel', 'Miles'],
    femaleFirst: ['Emily', 'Hannah', 'Olivia', 'Chloe', 'Grace', 'Lily', 'Sophie', 'Emma', 'Mia', 'Ella'],
    neutralFirst: ['Alex', 'Taylor', 'Jordan', 'Avery', 'Casey'],
    last: ['Miller', 'Carter', 'Bennett', 'Parker', 'Collins', 'Foster', 'Reed', 'Hughes', 'Bailey', 'Walker'],
  },
  fr: {
    maleFirst: ['Louis', 'Gabriel', 'Hugo', 'Jules', 'Théo', 'Arthur', 'Lucas', 'Nathan'],
    femaleFirst: ['Camille', 'Léa', 'Chloé', 'Jade', 'Manon', 'Sarah', 'Emma', 'Zoé'],
    neutralFirst: ['Alex', 'Charlie', 'Lou', 'Noa'],
    last: ['Martin', 'Bernard', 'Dubois', 'Laurent', 'Petit', 'Moreau', 'Simon', 'Michel'],
  },
  es: {
    maleFirst: ['Mateo', 'Daniel', 'Pablo', 'Diego', 'Lucas', 'Javier', 'Adrián', 'Marco'],
    femaleFirst: ['Lucía', 'Sofía', 'Marta', 'Elena', 'Carla', 'Paula', 'Inés', 'Alba'],
    neutralFirst: ['Alex', 'Noa', 'Dani', 'Cris'],
    last: ['García', 'López', 'Martínez', 'Sánchez', 'Romero', 'Navarro', 'Torres', 'Ruiz'],
  },
  it: {
    maleFirst: ['Luca', 'Marco', 'Matteo', 'Davide', 'Andrea', 'Simone', 'Paolo', 'Enzo'],
    femaleFirst: ['Giulia', 'Sofia', 'Chiara', 'Martina', 'Elena', 'Alice', 'Sara', 'Lucia'],
    neutralFirst: ['Alex', 'Sam', 'Nico', 'Vale'],
    last: ['Rossi', 'Bianchi', 'Romano', 'Gallo', 'Costa', 'Mancini', 'Lombardi', 'Moretti'],
  },
};
const TITLE_HINTS = [
  { forms: ['herr'], gender: 'male', locale: 'de' },
  { forms: ['frau'], gender: 'female', locale: 'de' },
  { forms: ['mr', 'mr.'], gender: 'male', locale: 'en' },
  { forms: ['mrs', 'mrs.', 'ms', 'ms.', 'miss'], gender: 'female', locale: 'en' },
  { forms: ['monsieur'], gender: 'male', locale: 'fr' },
  { forms: ['madame', 'mlle'], gender: 'female', locale: 'fr' },
  { forms: ['señor', 'senor'], gender: 'male', locale: 'es' },
  { forms: ['señora', 'senora', 'sra', 'sra.'], gender: 'female', locale: 'es' },
  { forms: ['signor', 'sig.'], gender: 'male', locale: 'it' },
  { forms: ['signora', 'sig.ra'], gender: 'female', locale: 'it' },
];
const ADDRESS_DATA = {
  de: {
    entries: [
      { street: 'Bergstraße', number: '27', postal: '50667', city: 'Köln' },
      { street: 'Lindenweg', number: '14', postal: '20095', city: 'Hamburg' },
      { street: 'Schillerstraße', number: '8', postal: '04109', city: 'Leipzig' },
      { street: 'Goethestraße', number: '19', postal: '80331', city: 'München' },
    ],
    labels: { native: 'Deutschland', english: 'Germany', code: 'DE' },
  },
  at: {
    entries: [
      { street: 'Mariahilfer Straße', number: '33', postal: '1070', city: 'Wien' },
      { street: 'Herrengasse', number: '21', postal: '8010', city: 'Graz' },
      { street: 'Getreidegasse', number: '9', postal: '5020', city: 'Salzburg' },
      { street: 'Landstraßer Hauptstraße', number: '18', postal: '1030', city: 'Wien' },
    ],
    labels: { native: 'Österreich', english: 'Austria', code: 'AT' },
  },
  ch: {
    entries: [
      { street: 'Bahnhofstrasse', number: '18', postal: '8001', city: 'Zürich' },
      { street: 'Rue du Rhône', number: '24', postal: '1204', city: 'Genève' },
      { street: 'Freie Strasse', number: '12', postal: '4001', city: 'Basel' },
      { street: 'Marktgasse', number: '31', postal: '3011', city: 'Bern' },
    ],
    labels: { native: 'Schweiz', english: 'Switzerland', code: 'CH' },
  },
  us: {
    entries: [
      { street: 'Cedar Ave', number: '742', city: 'Portland', state: 'OR', postal: '97205' },
      { street: 'Maple Street', number: '918', city: 'Denver', state: 'CO', postal: '80203' },
      { street: 'Lakeview Drive', number: '155', city: 'Madison', state: 'WI', postal: '53703' },
      { street: 'Oak Ridge Road', number: '481', city: 'Austin', state: 'TX', postal: '78701' },
    ],
    labels: { native: 'USA', english: 'United States', code: 'US' },
  },
  uk: {
    entries: [
      { street: 'Willow Road', number: '28', city: 'Manchester', postal: 'M1 4AE' },
      { street: 'Bridge Street', number: '39', city: 'Leeds', postal: 'LS1 4DY' },
      { street: 'Kingsway', number: '14', city: 'Bristol', postal: 'BS1 5AH' },
      { street: 'Rose Lane', number: '7', city: 'Liverpool', postal: 'L1 8JQ' },
    ],
    labels: { native: 'United Kingdom', english: 'United Kingdom', code: 'UK' },
  },
  fr: {
    entries: [
      { street: 'Rue des Tilleuls', number: '12', postal: '69002', city: 'Lyon' },
      { street: 'Avenue Victor Hugo', number: '8', postal: '33000', city: 'Bordeaux' },
      { street: 'Boulevard Saint-Michel', number: '21', postal: '31000', city: 'Toulouse' },
      { street: 'Rue de la Paix', number: '4', postal: '44000', city: 'Nantes' },
    ],
    labels: { native: 'France', english: 'France', code: 'FR' },
  },
  es: {
    entries: [
      { street: 'Calle Mayor', number: '24', postal: '28013', city: 'Madrid' },
      { street: 'Avenida del Puerto', number: '11', postal: '46002', city: 'Valencia' },
      { street: 'Calle de Alcalá', number: '63', postal: '50001', city: 'Zaragoza' },
      { street: 'Paseo del Prado', number: '17', postal: '29015', city: 'Málaga' },
    ],
    labels: { native: 'España', english: 'Spain', code: 'ES' },
  },
  it: {
    entries: [
      { street: 'Via Roma', number: '18', postal: '20121', city: 'Milano' },
      { street: 'Corso Vittorio Emanuele', number: '42', postal: '10121', city: 'Torino' },
      { street: 'Via Garibaldi', number: '9', postal: '40121', city: 'Bologna' },
      { street: 'Piazza Verdi', number: '6', postal: '35122', city: 'Padova' },
    ],
    labels: { native: 'Italia', english: 'Italy', code: 'IT' },
  },
  nl: {
    entries: [
      { street: 'Lindestraat', number: '15', postal: '1012 AB', city: 'Amsterdam' },
      { street: 'Prinsengracht', number: '66', postal: '3011 CE', city: 'Rotterdam' },
      { street: 'Stationsweg', number: '9', postal: '3511 ED', city: 'Utrecht' },
      { street: 'Noorderstraat', number: '24', postal: '9711 LM', city: 'Groningen' },
    ],
    labels: { native: 'Nederland', english: 'Netherlands', code: 'NL' },
  },
};
const COMPANY_BASES = {
  de: ['Nordlicht', 'Rheinblick', 'Morgenstern', 'Stadtwald', 'Bergkern', 'Elbbogen'],
  en: ['Northshore', 'Riverstone', 'Oakfield', 'Clearbridge', 'Brightwell', 'Westhaven'],
  fr: ['Montclair', 'Rivesud', 'Beaufort', 'Clairmont', 'Valdor', 'Lumière'],
  es: ['Monteclaro', 'Rioalto', 'Solverde', 'Pradonorte', 'Puertoluz', 'Llanura'],
  it: ['Belmonte', 'Novafonte', 'Valleverde', 'Stellalta', 'Pianoro', 'Rivabella'],
};
const COMPANY_SUFFIX_PATTERNS = [
  { re: /\bGmbH & Co\. KG\b$/i, locale: 'de' },
  { re: /\bUG\s*\(haftungsbeschränkt\)\b$/i, locale: 'de' },
  { re: /\bGmbH\b$/i, locale: 'de' },
  { re: /\bAG\b$/i, locale: 'de' },
  { re: /\bKG\b$/i, locale: 'de' },
  { re: /\bOHG\b$/i, locale: 'de' },
  { re: /\be\.K\.?$/i, locale: 'de' },
  { re: /\bLLC\b$/i, locale: 'en' },
  { re: /\bInc\.?$/i, locale: 'en' },
  { re: /\bLtd\.?$/i, locale: 'en' },
  { re: /\bCorp\.?$/i, locale: 'en' },
  { re: /\bCorporation\b$/i, locale: 'en' },
  { re: /\bS\.A\.R\.L\.?$/i, locale: 'fr' },
  { re: /\bSARL\b$/i, locale: 'fr' },
  { re: /\bSAS\b$/i, locale: 'fr' },
  { re: /\bS\.L\.?$/i, locale: 'es' },
  { re: /\bSL\b$/i, locale: 'es' },
  { re: /\bS\.r\.l\.?$/i, locale: 'it' },
  { re: /\bSpA\b$/i, locale: 'it' },
  { re: /\bBV\b$/i, locale: 'de' },
  { re: /\bNV\b$/i, locale: 'de' },
];

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

export function createContextAwareReplacement(original, category, proposedReplacement = '', options = {}) {
  const suggested = normalizeSuggestedReplacement(original, proposedReplacement);

  if (category === 'other' && suggested) {
    return suggested;
  }

  const generated = createFallbackReplacement(original, category, options);
  if (generated && generated !== original && !generated.includes(original)) {
    return generated;
  }

  return suggested || createGenericReplacement(original, options);
}

export function createFallbackReplacement(original, category, options = {}) {
  const seedKey = buildSeedKey(original, options);

  switch (category) {
    case 'email':
      return `person-${hashString(seedKey).slice(0, 6)}@example.invalid`;
    case 'iban':
      return formatIbanLike(original, makeGermanIban(seedKey));
    case 'credit_card':
      return formatDigitsLike(original, makeLuhnNumber(original, seedKey));
    case 'phone':
      return formatDigitsLike(original, makePhoneDigits(original, seedKey), { preserveLeadingPlus: true });
    case 'ip_address':
      return original.includes(':') ? makeIPv6(seedKey) : makeIPv4(seedKey);
    case 'date':
      return makeDate(original, seedKey);
    case 'name':
      return createNameReplacement(original, seedKey);
    case 'address':
      return createAddressReplacement(original, seedKey);
    case 'company':
      return createCompanyReplacement(original, seedKey);
    case 'national_id':
    case 'passport':
    case 'driver_license':
    case 'medical_record':
      return makePatternLike(original, seedKey);
    default:
      return createGenericReplacement(original, options);
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

function buildSeedKey(original, options = {}) {
  const variant = Number(options.variant) || 0;
  const base = String(options.seedKey || original || '');
  return variant > 0 ? `${base}#${variant}` : base;
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

function makeGermanIban(seedKey) {
  const bankCode = '50010517';
  const account = String(numericSeed(seedKey) % 10000000000).padStart(10, '0');
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

function makeLuhnNumber(original, seedKey) {
  const length = Math.min(Math.max(onlyDigits(original).length, 13), 19);
  const seed = String(numericSeed(seedKey)).padEnd(length, '0');
  let body = `4${seed}`.slice(0, length - 1);

  for (let digit = 0; digit <= 9; digit++) {
    const candidate = `${body}${digit}`;
    if (luhnValid(candidate)) return candidate;
  }

  body = body.slice(0, -1) + '0';
  return `${body}0`;
}

function makePhoneDigits(original, seedKey) {
  const length = onlyDigits(original).length;
  const seed = String(numericSeed(seedKey));
  const { countryCode, subscriberLength } = splitPhoneNumber(original);
  const subscriber = DIGIT_STREAM.concat(seed).repeat(2).slice(0, Math.max(subscriberLength, 0));
  return `${countryCode}${subscriber}`.slice(0, length);
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

function splitPhoneNumber(original) {
  const digits = onlyDigits(original);
  if (!original.trim().startsWith('+')) {
    return { countryCode: '', subscriberLength: digits.length };
  }

  const match = COUNTRY_CALLING_CODES
    .sort((a, b) => b.length - a.length)
    .find(code => digits.startsWith(code) && digits.length - code.length >= 6);
  const countryCode = match || digits.slice(0, Math.min(3, Math.max(digits.length - 6, 1)));

  return {
    countryCode,
    subscriberLength: digits.length - countryCode.length,
  };
}

function makeIPv4(seedKey) {
  return `203.0.113.${(numericSeed(seedKey) % 254) + 1}`;
}

function makeIPv6(seedKey) {
  return `2001:db8::${(numericSeed(seedKey) % 65535).toString(16)}`;
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

function makeDate(original, seedKey) {
  const parsed = parseDate(original);
  const day = String((numericSeed(seedKey) % 27) + 1).padStart(2, '0');
  const month = String((numericSeed(`${seedKey}:month`) % 12) + 1).padStart(2, '0');
  const year = parsed?.shortYear ? '88' : '1988';

  if (parsed?.order === 'ymd') {
    return `${year}-${month}-${day}`;
  }

  const separator = parsed?.separator || '.';
  return `${day}${separator}${month}${separator}${year}`;
}

function createNameReplacement(original, seedKey) {
  const parts = original.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return createGenericReplacement(original);

  const title = getTitleInfo(parts[0]);
  const locale = title?.locale || inferLocaleFromText(original);
  const body = title ? parts.slice(1) : parts;
  const titleText = title ? parts[0] : '';

  if (body.length === 0) return titleText || createGenericReplacement(original);

  const gender = title?.gender || inferGenderFromName(body[0], locale);
  const mapped = body.map((part, index) => mapNamePart(part, {
    index,
    total: body.length,
    gender,
    locale,
    seedKey,
  }));

  return titleText ? `${titleText} ${mapped.join(' ')}` : mapped.join(' ');
}

function mapNamePart(part, context) {
  if (!part) return part;

  if (NAME_PARTICLES.has(part.toLowerCase())) {
    return applyCasePattern(part, part.toLowerCase());
  }

  if (part.includes('-')) {
    return part
      .split('-')
      .map((segment, index) => mapNamePart(segment, {
        ...context,
        seedKey: `${context.seedKey}:hyphen:${context.index}:${index}`,
      }))
      .join('-');
  }

  if (/^[\p{L}]\.$/u.test(part)) {
    const token = context.index === context.total - 1 && context.total > 1
      ? pickSurname(context.locale, `${context.seedKey}:initial:last:${context.index}`)
      : pickFirstName(context.locale, context.gender, `${context.seedKey}:initial:first:${context.index}`);
    return `${token[0].toUpperCase()}.`;
  }

  const looksSingleGivenName = context.total === 1 && looksLikeGivenName(part, context.locale);
  const shouldUseFirstName = context.index === 0 && (context.total > 1 || looksSingleGivenName);
  const replacement = shouldUseFirstName
    ? pickFirstName(context.locale, context.gender, `${context.seedKey}:first:${context.index}`)
    : pickSurname(context.locale, `${context.seedKey}:last:${context.index}`);

  return applyCasePattern(part, replacement);
}

function createAddressReplacement(original, seedKey) {
  const country = inferAddressCountry(original);
  const catalog = ADDRESS_DATA[country] || ADDRESS_DATA[inferLocaleFromText(original) === 'de' ? 'de' : 'us'];
  const entry = pickFrom(catalog.entries, `${seedKey}:address`);
  const streetLine = country === 'us' || country === 'uk'
    ? `${entry.number} ${entry.street}`
    : `${entry.street} ${entry.number}`;
  const localityLine = formatLocalityLine(country, entry);
  const countryLabel = resolveCountryLabel(original, catalog.labels);
  const parts = [streetLine, localityLine, countryLabel].filter(Boolean);

  if (!/[,\n]/.test(original) && !/\d{4,5}/.test(original)) {
    return streetLine;
  }

  return original.includes('\n') ? parts.join('\n') : parts.join(', ');
}

function formatLocalityLine(country, entry) {
  switch (country) {
    case 'us':
      return `${entry.city}, ${entry.state} ${entry.postal}`;
    case 'uk':
      return `${entry.city} ${entry.postal}`;
    case 'nl':
      return `${entry.postal} ${entry.city}`;
    default:
      return `${entry.postal} ${entry.city}`;
  }
}

function resolveCountryLabel(original, labels) {
  if (new RegExp(`\\b${escapeRegExp(labels.native)}\\b`, 'i').test(original)) return labels.native;
  if (new RegExp(`\\b${escapeRegExp(labels.english)}\\b`, 'i').test(original)) return labels.english;
  if (new RegExp(`\\b${escapeRegExp(labels.code)}\\b`).test(original)) return labels.code;
  return '';
}

function createCompanyReplacement(original, seedKey) {
  const suffixInfo = detectCompanySuffix(original);
  const locale = suffixInfo?.locale || inferLocaleFromText(original);
  const base = pickFrom(COMPANY_BASES[locale] || COMPANY_BASES.en, `${seedKey}:company`);
  const suffix = suffixInfo?.suffix || '';
  return suffix ? `${base} ${suffix}` : base;
}

function detectCompanySuffix(original) {
  for (const pattern of COMPANY_SUFFIX_PATTERNS) {
    const match = original.match(pattern.re);
    if (match) {
      return { suffix: match[0], locale: pattern.locale };
    }
  }
  return null;
}

function makePatternLike(original, seedKey) {
  let digitIndex = 0;
  let upperIndex = 0;
  let lowerIndex = 0;
  const digitStream = DIGIT_STREAM.concat(String(numericSeed(seedKey))).repeat(3);
  const upperStream = UPPER_STREAM.repeat(4);
  const lowerStream = LOWER_STREAM.repeat(4);

  return Array.from(original).map(char => {
    if (/\d/.test(char)) {
      const next = digitStream[digitIndex] || '0';
      digitIndex++;
      return next;
    }
    if (/[A-Z]/.test(char)) {
      const next = upperStream[(upperIndex + numericSeed(seedKey)) % upperStream.length] || 'X';
      upperIndex++;
      return next;
    }
    if (/[a-z]/.test(char)) {
      const next = lowerStream[(lowerIndex + numericSeed(`${seedKey}:lower`)) % lowerStream.length] || 'x';
      lowerIndex++;
      return next;
    }
    return char;
  }).join('');
}

function createGenericReplacement(original, options = {}) {
  const seedKey = buildSeedKey(original, options);
  return `Redacted-${hashString(seedKey).slice(0, 6)}`;
}

function normalizeSuggestedReplacement(original, proposedReplacement) {
  const suggested = String(proposedReplacement || '').trim();
  if (!suggested) return '';
  if (suggested === original) return '';
  if (suggested.includes(original)) return '';
  return suggested;
}

function inferLocaleFromText(value) {
  if (/[äöüß]/i.test(value) || /\b(Herr|Frau|Straße|Strasse|Weg|Allee|GmbH|AG)\b/i.test(value)) return 'de';
  if (/\b(Max|Moritz|Felix|Jonas|Lukas|Lea|Lena|Anna|Schmidt|Schneider|Weber|Meyer|Becker)\b/i.test(value)) return 'de';
  if (/[éèêëàâçîïôûù]/i.test(value) || /\b(Monsieur|Madame|Rue|Boulevard|Avenue|SARL|SAS)\b/i.test(value)) return 'fr';
  if (/[ñáéíóú]/i.test(value) || /\b(Señor|Señora|Calle|Avenida|Paseo|S\.L\.|SL)\b/i.test(value)) return 'es';
  if (/[àèéìíîòóù]/i.test(value) || /\b(Signor|Signora|Via|Piazza|Corso|S\.r\.l\.|SpA)\b/i.test(value)) return 'it';
  return 'en';
}

function inferAddressCountry(value) {
  if (/\b(Deutschland|Germany|DE)\b/i.test(value) || /\bStraße\b/i.test(value) || /\bStrasse\b/i.test(value)) return 'de';
  if (/\b(Österreich|Austria|AT)\b/i.test(value) || /\bWien\b/i.test(value)) return 'at';
  if (/\b(Schweiz|Switzerland|Suisse|CH)\b/i.test(value) || /\bZürich\b/i.test(value)) return 'ch';
  if (/\b(USA|United States|US)\b/i.test(value) || /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(value)) return 'us';
  if (/\b(United Kingdom|UK)\b/i.test(value) || /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/.test(value)) return 'uk';
  if (/\b(France|FR)\b/i.test(value) || /\b(Rue|Boulevard|Avenue)\b/i.test(value)) return 'fr';
  if (/\b(España|Spain|ES)\b/i.test(value) || /\b(Calle|Avenida|Paseo)\b/i.test(value)) return 'es';
  if (/\b(Italia|Italy|IT)\b/i.test(value) || /\b(Via|Piazza|Corso)\b/i.test(value)) return 'it';
  if (/\b(Netherlands|Nederland|NL)\b/i.test(value) || /\b\d{4}\s?[A-Z]{2}\b/.test(value)) return 'nl';
  return inferLocaleFromText(value) === 'de' ? 'de' : 'us';
}

function inferGenderFromName(token, locale) {
  const normalized = stripEdgePunctuation(token).toLowerCase();
  const data = NAME_DATA[locale] || NAME_DATA.en;

  if (data.femaleFirst.some(name => name.toLowerCase() === normalized)) return 'female';
  if (data.maleFirst.some(name => name.toLowerCase() === normalized)) return 'male';
  if (Object.values(NAME_DATA).some(group => group.femaleFirst.some(name => name.toLowerCase() === normalized))) return 'female';
  if (Object.values(NAME_DATA).some(group => group.maleFirst.some(name => name.toLowerCase() === normalized))) return 'male';
  return 'neutral';
}

function looksLikeGivenName(token, locale) {
  const normalized = stripEdgePunctuation(token).toLowerCase();
  const data = NAME_DATA[locale] || NAME_DATA.en;
  return [
    ...data.maleFirst,
    ...data.femaleFirst,
    ...data.neutralFirst,
  ].some(name => name.toLowerCase() === normalized);
}

function pickFirstName(locale, gender, seedKey) {
  const data = NAME_DATA[locale] || NAME_DATA.en;
  const pool = gender === 'female'
    ? data.femaleFirst
    : gender === 'male'
      ? data.maleFirst
      : data.neutralFirst;
  return pickFrom(pool, seedKey);
}

function pickSurname(locale, seedKey) {
  const data = NAME_DATA[locale] || NAME_DATA.en;
  return pickFrom(data.last, seedKey);
}

function pickFrom(list, seedKey) {
  return list[numericSeed(seedKey) % list.length];
}

function getTitleInfo(token) {
  const normalized = stripEdgePunctuation(token).toLowerCase();
  return TITLE_HINTS.find(entry => entry.forms.includes(normalized)) || null;
}

function stripEdgePunctuation(value) {
  return String(value || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '');
}

function applyCasePattern(template, replacement) {
  if (template.toUpperCase() === template) return replacement.toUpperCase();
  if (template.toLowerCase() === template) return replacement.toLowerCase();
  if (/^[A-ZÄÖÜ][a-zäöüß]+$/u.test(template)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
  }
  return replacement;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
