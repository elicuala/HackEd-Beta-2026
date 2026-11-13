// Owned by Agent L. A stand-in for the AI judge: plain keyword matching, no network.
// Used when JUDGE_MOCK=1 (always in `npm test`) or when there is no API key.
// It answers in the same shape as the real model (see schema.js).
import { lower } from "../rules/normalize.js";

const NONE = { verdict: "none", tactic: "none", quote: "", reason: "Nothing to call.", confidence: 0.5 };

const STAYING = /\b(?:won't|will not|not going to|not) hang(?:ing)? up\b/;
const DEFENSE =
  /\b(?:hang(?:ing)? up|call (?:you |them )?back|call (?:the|my)|official (?:number|website)|employee id|badge number|how do i know|prove|scam|fraud|not giving|won't give|not going to give|i'll check|never (?:ask|call)|doesn't (?:threaten|call|ask|sound))\b/;
const COMMITS = /\b(?:i'll|i will) (?:pay|buy|send|transfer|get the (?:money|cards))\b|\b(?:how (?:do|can|should) i pay|where do i (?:send|buy))\b/;

// Checked in this order. The first match wins.
const WARNINGS = [
  ["fear", /\b(?:oh no|am i in trouble|going to jail|arrest me|arrested|i'm scared|i'm worried|please don't)\b/],
  ["urgency", /\b(?:right now|right away|today then|as fast as|hurry)\b/],
  ["payment", /\b(?:what do i owe|how much|i should pay|pay it)\b/],
  ["authority", /\b(?:yes officer|yes sir|yes ma'am|whatever you say|you're the expert)\b/],
  ["sympathy", /\b(?:are you (?:okay|ok|hurt|alright)|oh sweetie|oh honey|oh dear|poor thing)\b/],
  ["secrecy", /\bour (?:little )?secret\b/],
  ["verification", /\bwhat do you need (?:from me|to verify)\b/],
];

/** @param line the latest victim line (already redacted) */
export function mockJudge(line) {
  const text = lower(line);
  const quote = String(line ?? "").trim();
  if (!quote) return NONE;

  if (DEFENSE.test(text) && !STAYING.test(text)) {
    return { verdict: "good_defense", tactic: "verification", quote, reason: "You checked before trusting the caller.", confidence: 0.9 };
  }
  if (COMMITS.test(text)) {
    return { verdict: "strike", tactic: "payment", quote, reason: "You agreed to pay the caller.", confidence: 0.85 };
  }
  for (const [tactic, pattern] of WARNINGS) {
    if (pattern.test(text)) {
      return { verdict: "warning", tactic, quote, reason: `The caller's ${tactic} tactic is starting to work.`, confidence: 0.7 };
    }
  }
  return NONE;
}
