// Owned by Agent B. The pushback counter: the drill ends after the person pushes back PUSHBACK_LIMIT times.
//
// The scenario prompts ask the caller to give up after a few pushbacks, but a model can't keep count reliably,
// so calls ran long. This counts on our side instead. A victim line counts once if it refuses, sounds skeptical
// (isPushback), or earned a good-defense credit. On the limit the call is ended through the core (endCall), so the
// reveal is "passed" and arrives with that turn's actions: the mask comes off right away.
// Shared by the browser turn route and the phone bridge. Every new count is published on the bus as
// "pushbacks" { count, limit }, so /api/stream watchers (the phone dashboard) see it live.
import { getCall, endCall } from "../core/calls.js";
import { publish, subscribe } from "../core/bus.js";
import { isPushback } from "../rules/agreement.js";
import { markPassedByPushback } from "../ref/index.js";

export const PUSHBACK_LIMIT = 3;

const counts = new Map(); // callId → pushbacks so far (live calls only)

// Forget a call once it's no longer live (revealed by strikes, red card, End, or a hang-up).
subscribe(null, ({ callId, kind, data }) => {
  if (kind === "status" && data?.status !== "live") counts.delete(callId);
});

export function pushbackCount(callId) {
  return counts.get(callId) ?? 0;
}

/**
 * Call after processTurn with the same turn and the actions it returned.
 * @returns {Promise<{ actions: object[], pushbacks: number }>}  actions, plus the reveal if this hit the limit
 */
export async function afterTurn(callId, turn, actions, { limit = PUSHBACK_LIMIT } = {}) {
  const list = Array.isArray(actions) ? actions : [];
  const done = () => ({ actions: list, pushbacks: pushbackCount(callId) });
  if (turn?.speaker !== "victim" || list.some((a) => a?.type === "reveal")) return done();
  if (getCall(callId)?.status !== "live") return done();
  const credited = list.some((a) => a?.event?.tier === "good_defense");
  if (!credited && !isPushback(turn.text)) return done();

  const count = pushbackCount(callId) + 1;
  counts.set(callId, count);
  publish(callId, "pushbacks", { count, limit });
  if (count < limit) return { actions: list, pushbacks: count };
  // That's enough: the caller gives up and the mask comes off. The unmask praises the pushing back (not "you
  // ended the call", since they didn't) and tells them to hang up on a real one.
  markPassedByPushback(callId);
  return { actions: [...list, ...(await endCall(callId))], pushbacks: count };
}

export function _resetPushbacksForTests() {
  counts.clear();
}
