// FOUNDATION: locked. Turns a finished line of speech into actions.
import { redact, validateTurn, STOP_PHRASES } from "../shared/contract.js";
import { handleEvent, endCall } from "./callState.js";

const STOP_RE = new RegExp(`\\b(${STOP_PHRASES.join("|")})\\b`, "i");

/**
 * @param state  call state from createCallState
 * @param turn   { speaker, text (RAW), t }
 * @param ctx    { checkRules, judgeTurn, scenario }
 * Rules receive the RAW victim line (they need digits). The judge and history only ever see REDACTED text.
 */
export async function onTurn(state, turn, ctx) {
  if (!validateTurn(turn).ok || state.status !== "live") return { state, actions: [] };

  let s = {
    ...state,
    history: [...state.history, { speaker: turn.speaker, text: redact(turn.text), t: turn.t }],
  };

  if (turn.speaker === "scammer") {
    s.lastScammerLine = turn.text;
    const lower = turn.text.toLowerCase();
    const flags = ctx.scenario?.red_flag_phrases ?? [];
    if (s.redFlagAt === null && flags.some((p) => lower.includes(p.toLowerCase()))) {
      s.redFlagAt = turn.t;
    }
    return { state: s, actions: [] };
  }

  if (STOP_RE.test(turn.text)) return endCall(s);

  const actions = [];
  const apply = (events) => {
    for (const e of events ?? []) {
      if (s.status !== "live") break;
      const r = handleEvent(s, e);
      s = r.state;
      actions.push(...r.actions);
    }
  };

  let ruleEvents = [];
  try {
    ruleEvents = ctx.checkRules({
      victimLine: turn.text,
      lastScammerLine: s.lastScammerLine,
      secondsSinceRedFlag: s.redFlagAt === null ? 0 : turn.t - s.redFlagAt,
      alreadyStruck: new Set(s.struck),
    });
  } catch {
    ruleEvents = [];
  }
  apply(ruleEvents);
  if (s.status !== "live") return { state: s, actions };

  let aiEvents = [];
  try {
    aiEvents = await ctx.judgeTurn({ recentTurns: s.history.slice(-6), scenario: ctx.scenario });
  } catch {
    aiEvents = [];
  }
  apply((aiEvents ?? []).map((e) => ({ ...e, source: "ai" })));

  return { state: s, actions };
}
