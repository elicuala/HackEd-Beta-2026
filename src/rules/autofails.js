// Owned by Agent L. The red cards: things that end the drill on the spot.
import { collapseDigits, countDigits, lower, sentenceWith } from "./normalize.js";
import { agrees, isRefusal, AGREE } from "./agreement.js";

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const YEAR = "(?:19\\d\\d|20[0-2]\\d)";
const STREET = "(?:street|st|avenue|ave|road|rd|boulevard|blvd|crescent|cres|lane|drive|trail|terrace)";
const NOT_A_STREET_NAME = "(?:i|a|the|to|and|that|you|we|my|of|in|on|is|or)";

export const DATE_PATTERNS = [
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+${YEAR})?\\b`, "gi"), // March 3, 1952
  new RegExp(`\\b${MONTH}\\s+[a-z-]+,?\\s+${YEAR}\\b`, "gi"), // March third 1952
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+of\\s+${MONTH}(?:,?\\s+${YEAR})?\\b`, "gi"), // 3rd of March 1952
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, // 03/03/1952
  new RegExp(`\\b(?:in|since|born|year|from|of)\\s+${YEAR}\\b`, "gi"), // born in 1952
  new RegExp(`\\b${MONTH}\\s+${YEAR}\\b`, "gi"), // March 2024
];

export const ADDRESS = new RegExp(
  `\\b\\d{1,5}[a-z]?\\s+(?:(?!${NOT_A_STREET_NAME}\\b)[a-z0-9']+\\s+){0,2}${STREET}\\b`,
  "gi",
);

// A ten-digit phone number standing on its own: 780 555 1234.
const PHONE = /(?<!\d[\s.-]?)\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\s.-]?\d)/g;
const MONEY = /\$\s?\d[\d,.]*/g;
const COUNTED =
  /\b\d[\d,.]*\s*(?:dollars?|bucks|cents|percent|years?|months?|weeks?|days?|hours?|minutes?|times|people|kids|grandkids|grandchildren|cards?)\b/gi;

/** Remove numbers that are clearly not account numbers: money, dates, addresses, phone numbers, counts. */
export function accountDigits(normalized) {
  let text = normalized.replace(MONEY, " ").replace(COUNTED, " ").replace(ADDRESS, " ");
  for (const re of DATE_PATTERNS) text = text.replace(re, " ");
  text = text.replace(PHONE, " ");
  return collapseDigits(text);
}

const SIN_PHRASE = /\b(?:(?:my|the)\s+(?:sin|social insurance)(?:\s+number)?|social insurance number)\s+is\b(.*)/;
const SIN_DODGE = /^\s*(?:none|not|n't|nothing|private|mine|my business|confidential|something)\b/;

const ASKS_FOR_CODE = /\b(?:code|pin|password|passcode|passphrase|verification)\b/;
const ASKS_FOR_GIFT_CARD = /\b(?:gift\s?cards?|itunes|google play|steam cards?|prepaid cards?|vouchers?)\b/;
const ASKS_FOR_TRANSFER = /\b(?:bitcoin|crypto|cryptocurrency|wire|e-?transfer|interac|western union|moneygram)\b/;
const ASKS_FOR_REMOTE = /\b(?:anydesk|teamviewer|download|remote|app|install)\b/;

// One-word replies that are not a password.
const NOT_A_PASSWORD = new Set([
  "yes", "yeah", "yep", "yup", "no", "nope", "nah", "ok", "okay", "sure", "what", "huh", "hello", "hi",
  "sorry", "pardon", "why", "who", "how", "when", "where", "hmm", "um", "uh", "never", "really", "right",
  "alright", "fine", "wait", "bye", "goodbye", "thanks", "nothing", "none", "maybe", "excuse",
]);

function saidAPassword(line) {
  const words = lower(line).match(/[a-z0-9']+/g) ?? [];
  return words.length === 1 && words[0].length >= 3 && words[0].length <= 20 && !NOT_A_PASSWORD.has(words[0]);
}

/**
 * @param normalized  the victim line after normalizeNumbers (spoken numbers are digits now)
 * @param scammer     the last scammer line, lowercased
 * @returns {{ type: string, quote: string } | null}  the first autofail that fires
 */
export function findAutofail(normalized, scammer) {
  const text = lower(normalized);
  const digits = accountDigits(text);
  const digitCount = countDigits(digits);

  const sin = SIN_PHRASE.exec(text);
  if (digitCount === 9 || (sin && !SIN_DODGE.test(sin[1]))) {
    return { type: "sin_number", quote: normalized.trim() };
  }

  const askedForCode = ASKS_FOR_CODE.test(scammer);
  if (askedForCode && digitCount >= 3 && digitCount < 12) {
    return { type: "password_or_code", quote: normalized.trim() };
  }
  if (/\d{4,}/.test(digits)) {
    return { type: "card_number", quote: normalized.trim() };
  }
  if (askedForCode && saidAPassword(normalized) && !isRefusal(normalized)) {
    return { type: "password_or_code", quote: normalized.trim() };
  }

  const asks = [
    ["gift_card", ASKS_FOR_GIFT_CARD],
    ["crypto_or_wire", ASKS_FOR_TRANSFER],
    ["remote_access", ASKS_FOR_REMOTE],
  ];
  for (const [type, pattern] of asks) {
    if (pattern.test(scammer) && agrees(normalized)) {
      return { type, quote: sentenceWith(normalized, AGREE) };
    }
  }
  return null;
}

export const AUTOFAIL_TYPES = [
  "card_number", "sin_number", "password_or_code", "gift_card", "crypto_or_wire", "remote_access",
];
