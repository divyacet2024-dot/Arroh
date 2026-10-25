/**
 * kannadaNumbers — Kannada spoken/script digit normalizer.
 *
 * ROOT CAUSE: extractPhoneFromSpeech() in PatientLogin only stripped non-ASCII
 * characters then ran a digit regex, which means:
 *   - Kannada script digits (೦–೯) were removed, not converted.
 *   - Spoken Kannada words ("ಒಂಬತ್ತು") were not recognized at all.
 *   - ASR transliterations ("ombattu", "ondu") were not handled.
 *
 * This module fixes all three cases with a single normalize() pass.
 */

// ── Kannada script digits → ASCII ────────────────────────────────────────────
const KN_SCRIPT: Record<string, string> = {
  '೦': '0', '೧': '1', '೨': '2', '೩': '3', '೪': '4',
  '೫': '5', '೬': '6', '೭': '7', '೮': '8', '೯': '9',
};

// ── Spoken Kannada number words → digit ──────────────────────────────────────
// Each entry is: [digit, ...alternates/ASR variants]
// ASR for Kannada often produces transliterated English words.
const KN_WORDS: Array<[string, ...string[]]> = [
  ['0', 'ಸೊನ್ನೆ',  'ಶೂನ್ಯ',   'sonne',   'shonya',  'shunya',  'zero',  'zer'],
  ['1', 'ಒಂದು',    'ondu',    'ond',     'one'],
  ['2', 'ಎರಡು',    'eradu',   'erdu',    'two'],
  ['3', 'ಮೂರು',    'mooru',   'muru',    'three'],
  ['4', 'ನಾಲ್ಕು',  'naalku',  'nalku',   'four'],
  ['5', 'ಐದು',     'aidu',    'five'],
  ['6', 'ಆರು',     'aaru',    'aru',     'six'],
  ['7', 'ಏಳು',     'yelu',    'elu',     'seven'],
  ['8', 'ಎಂಟು',    'entu',    'eight'],
  ['9', 'ಒಂಬತ್ತು', 'ombattu', 'ombatu',  'nine'],
];

// Build a sorted map: longer words must match before shorter ones to avoid
// partial matches ("ಒಂದು" before "ಒಂ").
const WORD_MAP: Array<{ pattern: RegExp; digit: string }> = KN_WORDS
  .flatMap(([digit, ...words]) =>
    words.map((w) => ({ digit, word: w }))
  )
  .sort((a, b) => b.word.length - a.word.length)
  .map(({ digit, word }) => ({
    digit,
    pattern: new RegExp(word, 'gi'),
  }));

/**
 * Normalize a string containing Kannada script/spoken/transliterated digits
 * into a plain ASCII digit string.
 *
 * Examples:
 *   "ಒಂಬತ್ತು ಒಂಬತ್ತು ಏಳು ಎರಡು ಒಂದು" → "99721"
 *   "೯೯೭೨೧"                         → "99721"
 *   "9 9 7 2 1"                      → "99721"
 */
export function normalizeToDigits(text: string): string {
  let s = text;

  // 1. Replace Kannada script digits.
  s = s.replace(/[೦-೯]/g, (ch) => KN_SCRIPT[ch] ?? ch);

  // 2. Replace spoken/transliterated words (longest first).
  for (const { pattern, digit } of WORD_MAP) {
    s = s.replace(pattern, digit);
  }

  // 3. Keep only ASCII digits.
  return s.replace(/\D/g, '');
}

// ── Mobile number validation ─────────────────────────────────────────────────
const MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * Extract a valid Indian mobile number from natural speech in any supported
 * language/script. Returns null if no valid number found.
 *
 * Handles:
 *   - Kannada script: "೯೮೭೬೫೪೩೨೧೦"
 *   - Spoken Kannada: "ಒಂಬತ್ತು ಒಂಬತ್ತು ಏಳು..."
 *   - ASR transliterations: "ombattu ombattu yelu eradu ondu..."
 *   - Mixed: "ನನ್ನ ನಂಬರ್ 9972143210"
 *   - Plain English digits: "9972143210"
 *   - Space-separated: "9 9 7 2 1 4 3 2 1 0"
 */
export function extractMobileFromSpeech(text: string): string | null {
  const digits = normalizeToDigits(text);

  // Try to find a valid 10-digit mobile in the digit string.
  // Use greedy search from the first valid start digit (6–9).
  const match = digits.match(/[6-9]\d{9}/);
  if (match && MOBILE_RE.test(match[0])) return match[0];

  // If the whole normalized string is exactly 10 digits starting with 6–9.
  if (MOBILE_RE.test(digits)) return digits;

  return null;
}

/** Format a 10-digit number for display: "+91 98765 43210" */
export function formatMobileDisplay(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(-10);
  return `+91\u00A0${d.slice(0, 5)}\u00A0${d.slice(5)}`;
}

/** Normalise to E.164 "+91XXXXXXXXXX" for backend submission. */
export function toE164(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(-10);
  return `+91${d}`;
}
