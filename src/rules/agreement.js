// Owned by Agent L. Did the victim go along with what the scammer just asked?
// Refusals always win over agreement words.
import { lower } from "./normalize.js";

// Phrases that contain a refusal word but are not a refusal.
const BENIGN = /\b(?:no problem|no worries|not a problem|why not|oh no|no doubt)\b/g;

export const REFUSAL =
  /\b(?:no|nope|nah|not|never|won't|wont|can't|cannot|wouldn't|refuse|scam|scams|scammer|fraud|fake|hang(?:ing)? up|i'll call|i will call|i'm calling|call(?:ing)? (?:you back|them|the|my)|don't think so|don't (?:want|believe|trust|feel)|goodbye)\b/;

// Pushing back with a question is not agreeing, even if it starts with "okay".
const SKEPTICAL =
  /\b(?:why|how do i know|who are you|who is this|are you sure|is this (?:real|legit|a)|what for|prove|suspicious|doesn't sound|does not sound)\b/;

export const AGREE =
  /\b(?:yes|yeah|yep|yup|ok|okay|sure|alright|all right|i will|i'll|i can|of course|right away|go ahead|will do|got it|uh huh|mhm|mm-hmm|certainly|absolutely|if you say so|i guess so|let me (?:get|grab|go|find|write)|i'm on my way|i'm going)\b/;

/** True if the line pushes back: "no", "that's a scam", "I'll call them myself". */
export function isRefusal(line) {
  return REFUSAL.test(lower(line).replace(BENIGN, " "));
}

/**
 * True if the victim agreed.
 * `compliance` lists patterns that mean "yes" for one specific ask even though they contain a
 * refusal word, such as "I won't tell anyone" (secrecy) or "I won't hang up" (stay on the line).
 * `ignore` lists compliance patterns for other asks: they are set aside but don't count as a yes.
 * A real refusal anywhere else in the line still wins.
 */
export function agrees(line, compliance = [], ignore = []) {
  let text = lower(line).replace(BENIGN, " ");
  let complied = false;
  for (const pattern of ignore) text = text.replace(new RegExp(pattern.source, "g"), " ");
  for (const pattern of compliance) {
    const re = new RegExp(pattern.source, "g");
    if (re.test(text)) {
      complied = true;
      text = text.replace(re, " ");
    }
  }
  if (REFUSAL.test(text)) return false;
  if (complied) return true;
  if (SKEPTICAL.test(text)) return false;
  return AGREE.test(text);
}
