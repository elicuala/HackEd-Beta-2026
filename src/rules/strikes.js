// Owned by Agent L. Strikes: mistakes that don't end the drill on their own.
import { lower, sentenceWith } from "./normalize.js";
import { agrees, AGREE } from "./agreement.js";
import { FULL_DATE_PATTERNS, ADDRESS } from "./autofails.js";

export const LINGER_SECONDS = 45;

const BANK =
  /\b(?:rbc|royal bank|td|toronto[- ]dominion|bmo|bank of montreal|scotiabank|scotia|cibc|atb|tangerine|simplii|desjardins|national bank|eq bank|hsbc)\b/;

const BIRTH_WORDS = /\b(?:born|birthday|date of birth|birth date|birthdate|dob)\b/;
const YEAR_SAID = /\b(?:19\d\d|20[0-2]\d)\b/;
const MONTH_NAME =
  /\b(?:january|february|march|april|june|july|august|september|october|november|december)\b/;
const FULL_NAME = /\bmy (?:full |real |legal )?name(?:'s| is)\s+([a-z][a-z'-]+)\s+([a-z][a-z'-]+)/;
const NOT_A_NAME = new Set([
  "not", "none", "no", "nobody", "private", "irrelevant", "unimportant", "my", "your", "yours", "on", "in",
  "the", "a", "an", "is", "and", "but", "what", "why", "really", "also", "already", "going", "for", "to",
  "of", "that", "it", "i", "i'm", "so", "because", "or", "just", "something", "nothing",
]);

const ASKS_SECRECY =
  /\b(?:(?:don't|do not|not to|never|can't|cannot) (?:tell|mention|say|talk)|tell (?:no one|nobody)|secret|confidential|between (?:us|you and me|the two of us)|keep (?:this|it) (?:quiet|private|to yourself))\b/;
const KEEPS_SECRET = [
  /\b(?:won't|will not|not going to|not gonna|wouldn't) (?:tell|mention|say)\b/,
  /\bkeep (?:it|this) (?:a secret|secret|quiet|private|between us|to myself)\b/,
  /\b(?:our|a) (?:little )?secret\b/,
  /\bmy lips are sealed\b/,
];

const ASKS_TO_STAY =
  /\b(?:stay (?:on (?:the )?(?:line|phone|call)|with me)|(?:don't|do not|never) (?:hang up|disconnect|go anywhere|put the phone down)|remain on)\b/;
const STAYS = [
  /\b(?:i'll|i will|i'm|i am|i can) (?:stay|staying|hold|holding|wait|waiting)\b/,
  /\b(?:won't|will not|not going to|not gonna|i'm not) hang(?:ing)? up\b/,
  /\bstill here\b/,
  /\bnot going anywhere\b/,
];

const any = (patterns, text) => patterns.find((p) => p.test(text));

function findIdentity(text, scammer = "") {
  const name = FULL_NAME.exec(text);
  if (name && !NOT_A_NAME.has(name[1]) && !NOT_A_NAME.has(name[2])) return FULL_NAME;
  if (BIRTH_WORDS.test(text) && (/\d/.test(text) || MONTH_NAME.test(text))) return BIRTH_WORDS;
  // Answering "what's your date of birth?" with a year or a month gives it away too.
  // ("May" counts as a month here: they were asked for a date.)
  const monthSaid = MONTH_NAME.test(text) ? MONTH_NAME : /\bmay\b/.test(text) ? /\bmay\b/ : null;
  if (BIRTH_WORDS.test(scammer) && (YEAR_SAID.test(text) || monthSaid)) return YEAR_SAID.test(text) ? YEAR_SAID : monthSaid;
  for (const re of [...FULL_DATE_PATTERNS, ADDRESS]) {
    const fresh = new RegExp(re.source, "i");
    if (fresh.test(text)) return fresh;
  }
  return null;
}

/**
 * @param normalized  the victim line after normalizeNumbers
 * @param scammer     the last scammer line, lowercased
 * @returns {{ type: string, quote: string }[]}  every strike that applies, most serious first
 */
export function findStrikes(normalized, scammer, secondsSinceRedFlag) {
  const text = lower(normalized);
  const found = [];

  if (BANK.test(text)) found.push({ type: "confirmed_bank", quote: sentenceWith(normalized, BANK) });

  const identity = findIdentity(text, scammer);
  if (identity) found.push({ type: "confirmed_identity", quote: sentenceWith(normalized, identity) });

  if (ASKS_SECRECY.test(scammer) && agrees(normalized, KEEPS_SECRET, STAYS)) {
    found.push({ type: "secrecy", quote: sentenceWith(normalized, any(KEEPS_SECRET, text) ?? AGREE) });
  }

  if (ASKS_TO_STAY.test(scammer) && agrees(normalized, STAYS, KEEPS_SECRET)) {
    found.push({ type: "stayed_on_line", quote: sentenceWith(normalized, any(STAYS, text) ?? AGREE) });
  }

  if (secondsSinceRedFlag > LINGER_SECONDS) found.push({ type: "lingered", quote: normalized.trim() });

  return found;
}

export const STRIKE_TYPES = ["confirmed_bank", "confirmed_identity", "secrecy", "stayed_on_line", "lingered"];
