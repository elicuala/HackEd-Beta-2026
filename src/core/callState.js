// FOUNDATION: locked. Pure game rules. No I/O.
import { validateEvent, MAX_STRIKES, AI_STRIKE_MIN_CONFIDENCE } from "../shared/contract.js";

export function createCallState({ callId, scenarioId, channel = "browser" }) {
  return {
    callId,
    scenarioId,
    channel,            // "browser" | "phone"
    status: "live",     // "live" | "reveal"
    strikes: 0,
    struck: [],         // strike types already given (no double strikes)
    events: [],
    outcome: null,
    history: [],        // REDACTED turns only
    lastScammerLine: "",
    redFlagAt: null,    // seconds since start when the first red-flag line was said
  };
}

function revealAction(s, outcome) {
  s.status = "reveal";
  s.outcome = outcome;
  return { type: "reveal", outcome, events: s.events.slice() };
}

/** @returns {{ state: object, actions: object[] }} */
export function handleEvent(state, event) {
  if (state.status !== "live") return { state, actions: [] };
  if (!validateEvent(event).ok) return { state, actions: [] };

  const s = { ...state, events: [...state.events], struck: [...state.struck] };
  let e = { ...event };

  // Low-confidence AI strikes and repeat strike types become warnings.
  if (
    e.tier === "strike" &&
    ((e.source === "ai" && e.confidence < AI_STRIKE_MIN_CONFIDENCE) || s.struck.includes(e.type))
  ) {
    e = { ...e, tier: "warning" };
  }

  s.events.push(e);
  const actions = [];

  if (e.tier === "autofail") {
    actions.push(revealAction(s, "failed_autofail"));
  } else if (e.tier === "strike") {
    s.strikes += 1;
    s.struck.push(e.type);
    actions.push({ type: "strike_called", event: e, strikeNumber: s.strikes });
    if (s.strikes >= MAX_STRIKES) actions.push(revealAction(s, "failed_strikes"));
  } else if (e.tier === "warning") {
    actions.push({ type: "warning_shown", event: e });
  } else {
    actions.push({ type: "credit_shown", event: e });
  }
  return { state: s, actions };
}

/** Victim said a stop phrase, hung up, or pressed End. Reaching this while live means they passed. */
export function endCall(state) {
  if (state.status !== "live") return { state, actions: [] };
  const s = { ...state, events: [...state.events] };
  return { state: s, actions: [revealAction(s, "passed")] };
}
