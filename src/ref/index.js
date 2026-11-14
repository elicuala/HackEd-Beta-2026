// Owned by Agent L. Turns an action into what the ref says and which sound plays.
// scriptFor(action) -> { say: string|null, sound: "whistle"|"red_card"|"chime"|"fanfare"|null }
// All the wording lives in phrases.js.
import {
  STRIKE_NUMBERS, STRIKE_PHRASES, GENERIC_STRIKE, REVEAL, TRICK_SETUPS, GENERIC_SETUP,
  TRICK_PAYOFFS, GENERIC_PAYOFF, GOOD_DEFENSES, GENERIC_DEFENSE, ENDED_EARLY, PUSHED_BACK, PUSHED_BACK_CLOSE,
} from "./phrases.js";

// Calls that are about to end because the person pushed back enough times (src/voice/pushback.js marks them
// right before ending the call). Their "passed" unmask praises the pushing back instead of "you ended the call",
// and suggests hanging up, since they didn't.
const passedByPushback = new Set();

/** Mark a call so its next "passed" reveal uses the pushback wording. */
export function markPassedByPushback(callId) {
  if (typeof callId === "string" && callId) passedByPushback.add(callId);
}

const REVEAL_SOUND = { failed_autofail: "red_card", failed_strikes: "chime", passed: "fanfare" };

// Object.hasOwn so a type like "constructor" can't pull something odd off the prototype.
const pick = (table, key, fallback) => (typeof key === "string" && Object.hasOwn(table, key) ? table[key] : fallback);

function lastOfTier(events, tier) {
  return Array.isArray(events) ? events.findLast((e) => e?.tier === tier) : undefined;
}

/** "Strike one. You told them your bank. Scammers use that to sound legit." */
function strikeLine(action) {
  const number = STRIKE_NUMBERS[action.strikeNumber];
  const { what, why } = pick(STRIKE_PHRASES, action.event?.type, GENERIC_STRIKE);
  return `${number ? `Strike ${number}` : "Strike"}. ${what}. ${why}.`;
}

/** The event the unmask talks about: the red card, or else the latest strike, or else the latest warning. */
function topEvent(events) {
  return lastOfTier(events, "autofail") ?? lastOfTier(events, "strike") ?? lastOfTier(events, "warning");
}

function failedLine(action) {
  const setup = pick(TRICK_SETUPS, action.scenarioId, GENERIC_SETUP);
  const top = topEvent(action.events);
  const trick = top ? `${setup}, and ${pick(TRICK_PAYOFFS, top.type, GENERIC_PAYOFF)}.` : `${setup}.`;
  return `${REVEAL.failedOpen} ${trick} ${REVEAL.failedClose}`;
}

function passedLine(action) {
  if (passedByPushback.delete(action.callId)) return `${REVEAL.passedOpen} ${PUSHED_BACK} ${PUSHED_BACK_CLOSE}`;
  const defense = lastOfTier(action.events, "good_defense");
  const praise = defense ? pick(GOOD_DEFENSES, defense.type, GENERIC_DEFENSE) : ENDED_EARLY;
  return `${REVEAL.passedOpen} ${praise} ${REVEAL.passedClose}`;
}

export function scriptFor(action) {
  switch (action?.type) {
    case "strike_called":
      return { say: strikeLine(action), sound: "whistle" };
    case "credit_shown":
      return { say: null, sound: "chime" };
    case "reveal":
      return {
        say: action.outcome === "passed" ? passedLine(action) : failedLine(action),
        sound: REVEAL_SOUND[action.outcome] ?? "chime",
      };
    default: // warning_shown and anything unknown: silent
      return { say: null, sound: null };
  }
}
