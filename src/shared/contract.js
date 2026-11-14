// Shared contract for Loki. FOUNDATION: locked. Change only through a change request (SPEC.md §4).

export const TIERS = ["autofail", "strike", "warning", "good_defense"];
export const SOURCES = ["rules", "ai"];
export const STATUSES = ["live", "reveal"];
export const OUTCOMES = ["passed", "failed_strikes", "failed_autofail"];
export const SPEAKERS = ["victim", "scammer"];
export const ACTION_TYPES = ["strike_called", "warning_shown", "credit_shown", "reveal"];
/** The ref's sound identity (SPEC §0.4). Browser: synthesized by Agent F. Phone: tones by Agent B. */
export const SOUNDS = ["whistle", "red_card", "chime", "fanfare"];
/** Why the core turned a strike into a warning. Set on RefEvent.downgraded (SPEC §5.2). */
export const DOWNGRADE_REASONS = ["low_confidence", "repeat_type"];

export const MAX_STRIKES = 3;
export const AI_STRIKE_MIN_CONFIDENCE = 0.8;
export const STOP_PHRASES = ["drill", "stop"];

/**
 * @typedef {{ speaker: "victim"|"scammer", text: string, t: number }} Turn
 * @typedef {{ tier: "autofail"|"strike"|"warning"|"good_defense", type: string, quote: string,
 *             source: "rules"|"ai", confidence: number, t: number,
 *             downgraded?: "low_confidence"|"repeat_type" }} RefEvent
 * @typedef {{ say: string|null, sound: "whistle"|"red_card"|"chime"|"fanfare"|null }} RefScript
 * @typedef {{ type: "strike_called"|"warning_shown"|"credit_shown"|"reveal", callId: string,
 *             ref: RefScript, event?: RefEvent, strikeNumber?: number,
 *             outcome?: "passed"|"failed_strikes"|"failed_autofail", events?: RefEvent[],
 *             scenarioId?: string, scenarioTitle?: string, endedAt?: string }} WireAction
 */

/** Replace every digit with a bullet so numbers never leave a module. */
export function redact(text) {
  return String(text ?? "").replace(/\d/g, "•");
}

// Spoken numbers: a run of 2+ number words ("four five one two", "double five nine"). A run can't
// start with "oh" ("Oh, one more thing" stays readable). A lone number word ("one moment") is kept.
const NUMBER_WORDS =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|" +
  "sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|double|triple";
const SPOKEN_RUN = new RegExp(`\\b(?:${NUMBER_WORDS})(?:[\\s,-]+(?:oh|${NUMBER_WORDS}))+\\b`, "gi");

/**
 * redact() plus spoken numbers. Use for anything shown to other people (transcripts, the live board):
 * "my card is four five one two" → "my card is • • • •".
 */
export function redactSpeech(text) {
  return redact(text).replace(SPOKEN_RUN, (run) => run.replace(/[a-z]+/gi, "•"));
}

/** Build a well-formed event. The quote is always redacted. */
export function makeEvent({ tier, type, quote, source, confidence = 1, t = 0 }) {
  return {
    tier,
    type,
    quote: redact(quote),
    source,
    confidence: source === "rules" ? 1 : confidence,
    t,
  };
}

/** Returns { ok: boolean, errors: string[] }. */
export function validateEvent(e) {
  const errors = [];
  if (!e || typeof e !== "object") return { ok: false, errors: ["not an object"] };
  if (!TIERS.includes(e.tier)) errors.push(`bad tier: ${e.tier}`);
  if (typeof e.type !== "string" || !e.type) errors.push("missing type");
  if (typeof e.quote !== "string") errors.push("missing quote");
  if (/\d/.test(e.quote ?? "")) errors.push("quote contains unredacted digits");
  if (!SOURCES.includes(e.source)) errors.push(`bad source: ${e.source}`);
  if (typeof e.confidence !== "number" || e.confidence < 0 || e.confidence > 1)
    errors.push("confidence must be 0..1");
  if (e.source === "ai" && e.tier === "autofail") errors.push("ai cannot autofail");
  if (typeof e.t !== "number") errors.push("missing t");
  if ("downgraded" in e && !DOWNGRADE_REASONS.includes(e.downgraded))
    errors.push(`bad downgraded: ${e.downgraded}`);
  return { ok: errors.length === 0, errors };
}

/** Coerce anything into a safe RefScript: unknown sounds become null, digits are redacted. */
export function sanitizeScript(script) {
  const say = typeof script?.say === "string" && script.say.trim() ? redact(script.say) : null;
  const sound = SOUNDS.includes(script?.sound) ? script.sound : null;
  return { say, sound };
}

/** Returns { ok: boolean, errors: string[] }. */
export function validateTurn(turn) {
  const errors = [];
  if (!SPEAKERS.includes(turn?.speaker)) errors.push("bad speaker");
  if (typeof turn?.text !== "string") errors.push("missing text");
  if (typeof turn?.t !== "number") errors.push("missing t");
  return { ok: errors.length === 0, errors };
}

/** Required Scenario fields (validated by src/scenarios). */
export const SCENARIO_FIELDS = [
  "id", "title", "blurb", "opening_line", "goal", "escalation",
  "red_flag_phrases", "backs_off_when", "system_prompt",
];
