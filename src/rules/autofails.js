// Owned by Agent L. The red cards: things that end the drill on the spot.
import { collapseDigits, countDigits, lower, sentenceWith } from "./normalize.js";
import { agrees, isRefusal, AGREE } from "./agreement.js";

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const YEAR = "(?:19\\d\\d|20[0-2]\\d)";
const STREET = "(?:street|st|avenue|ave|road|rd|boulevard|blvd|crescent|cres|lane|drive|trail|terrace)";
const NOT_A_STREET_NAME = "(?:i|a|the|to|and|that|you|we|my|of|in|on|is|or)";

const MM = "(?:0?[1-9]|1[0-2])";
const DD = "(?:0?[1-9]|[12]\\d|3[01])";

/** Full dates (a day, a month and usually a year): giving one of these is giving your date of birth. */
export const FULL_DATE_PATTERNS = [
  // Year first, with a little filler: 1952 March 3rd, 1952, the 3rd of March, 2004 on May 12th.
  new RegExp(`\\b${YEAR}[.,]?\\s+(?:(?:the|on|of|in)\\s+)*(?:\\d{1,2}(?:st|nd|rd|th)?\\s+of\\s+)?${MONTH}(?:\\s+(?:the\\s+)?(?:\\d{1,2}(?:st|nd|rd|th)?|[a-z-]+))?\\b`, "gi"),
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+${YEAR})?\\b`, "gi"), // March 3, 1952
  new RegExp(`\\b${MONTH}\\s+[a-z-]+,?\\s+${YEAR}\\b`, "gi"), // March third 1952
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+of\\s+${MONTH}(?:,?\\s+${YEAR})?\\b`, "gi"), // 3rd of March 1952
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, // 03/03/1952
  // Year first: 1952-03-03, 1952/3/3, 1952 03 03, 1952.03.03, and 19520303 said as one run of digits.
  new RegExp(`\\b${YEAR}[\\s/.,-]+${MM}[\\s/.,-]+${DD}\\b`, "gi"),
  new RegExp(`\\b${YEAR}${MM.replace("0?", "0")}${DD.replace("0?", "0")}\\b`, "gi"),
];

export const DATE_PATTERNS = [
  ...FULL_DATE_PATTERNS,
  new RegExp(`\\b(?:in|since|born|year|from|of)\\s+${YEAR}\\b`, "gi"), // born in 1952
  new RegExp(`\\b${MONTH}\\s+${YEAR}\\b`, "gi"), // March 2024
  new RegExp(`\\b${YEAR},?\\s+${MONTH}\\b`, "gi"), // 1952, March
];

const MONTH_OR_BIRTH = new RegExp(`\\b(?:${MONTH}|born|birthday|birth|dob)\\b`, "i");
const YEAR_TOKEN = new RegExp(`\\b${YEAR}\\b`, "g");

/** A line that is only a year ("1952", "it's 2001"): a year, never a card number. */
const JUST_A_YEAR = new RegExp(`^\\D*\\b${YEAR}\\b\\D*$`);

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
  // A line about a date (a month name, or born / birthday): any year left in it is part of that date.
  if (MONTH_OR_BIRTH.test(normalized)) text = text.replace(/\b(?:19|20)\s+\d\d\b/g, " ").replace(YEAR_TOKEN, " ");
  text = text.replace(PHONE, " ");
  return collapseDigits(text);
}

const SIN_PHRASE = /\b(?:(?:my|the)\s+(?:sin|social insurance)(?:\s+number)?|social insurance number)\s+is\b(.*)/;
const SIN_DODGE = /^\s*(?:none|not|n't|nothing|private|mine|my business|confidential|something)\b/;

// Short numbers (4 to 11 digits) only count as a card number when the call is about a card or an account.
// Real card numbers are 13 to 19 digits, so 12 or more digits counts on its own.
const CARD_TALK =
  /\b(?:cards?|credit|debit|visa|master ?card|amex|account|acct|chequing|checking|savings|cvv|cvc|expir\w*|digits|routing|transit|institution|pin)\b/;
const CARD_DIGITS_ALONE = 12;

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
  // Asked about a card → any 4+ digits count. Only they mentioned a card → still not if it's just a year.
  const cardContext = CARD_TALK.test(scammer) || (CARD_TALK.test(text) && !JUST_A_YEAR.test(text));
  if (digitCount >= CARD_DIGITS_ALONE || (/\d{4,}/.test(digits) && cardContext)) {
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
