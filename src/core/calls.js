// FOUNDATION: locked. The ONLY way voice and phone code should run a call.
// Holds call state in memory, serializes turns per call, attaches ref scripts, publishes to the bus.
import { randomUUID } from "node:crypto";
import { createCallState, endCall as endState } from "./callState.js";
import { onTurn } from "./pipeline.js";
import { publish } from "./bus.js";
import { sanitizeScript } from "../shared/contract.js";
import { checkRules } from "../rules/index.js";
import { judgeTurn } from "../judge/index.js";
import { getScenario } from "../scenarios/index.js";
import { scriptFor } from "../ref/index.js";

const CALL_TTL_MS = 30 * 60 * 1000;
const calls = new Map(); // callId -> { state, scenario, queue, timer }

function notFound() {
  const err = new Error("Unknown callId");
  err.code = "CALL_NOT_FOUND";
  err.status = 404;
  err.expose = true;
  return err;
}

function safeScript(action) {
  try {
    return sanitizeScript(scriptFor(action));
  } catch {
    return { say: null, sound: null };
  }
}

function decorate(entry, action) {
  const wire = { ...action, callId: entry.state.callId };
  if (action.type === "reveal") {
    wire.scenarioId = entry.scenario.id;
    wire.scenarioTitle = entry.scenario.title;
    wire.endedAt = new Date().toISOString();
  }
  // scriptFor sees the full action (including scenarioId on reveal) so the unmask can fit the scenario.
  wire.ref = safeScript(wire);
  return wire;
}

function emit(entry, actions) {
  const wire = actions.map((a) => decorate(entry, a));
  for (const w of wire) publish(entry.state.callId, "action", w);
  if (entry.state.status !== "live") publish(entry.state.callId, "status", { status: entry.state.status });
  return wire;
}

function run(callId, fn) {
  const entry = calls.get(callId);
  if (!entry) return Promise.reject(notFound());
  const p = entry.queue.then(() => fn(entry));
  entry.queue = p.catch(() => {});
  return p;
}

/** @returns {{ callId: string, scenario: object }} Throws SCENARIO_NOT_FOUND for a bad id. */
export function createCall({ scenarioId, channel = "browser" }) {
  const scenario = getScenario(scenarioId);
  const callId = randomUUID();
  const state = createCallState({ callId, scenarioId: scenario.id, channel });
  const timer = setTimeout(() => calls.delete(callId), CALL_TTL_MS);
  timer.unref?.();
  calls.set(callId, { state, scenario, queue: Promise.resolve(), timer });
  publish(callId, "status", { status: "live" });
  return { callId, scenario };
}

/** Feed one finished line. turn.text is RAW. @returns {Promise<WireAction[]>} */
export function processTurn(callId, turn) {
  return run(callId, async (entry) => {
    const before = entry.state.history.length;
    const { state, actions } = await onTurn(entry.state, turn, {
      checkRules,
      judgeTurn,
      scenario: entry.scenario,
    });
    entry.state = state;
    if (state.history.length > before) publish(callId, "turn", state.history.at(-1));
    return emit(entry, actions);
  });
}

/** End button, hang-up, or timeout. @returns {Promise<WireAction[]>} (empty if already revealed) */
export function endCall(callId) {
  return run(callId, async (entry) => {
    const { state, actions } = endState(entry.state);
    entry.state = state;
    return emit(entry, actions);
  });
}

/** Read-only snapshot (redacted history). null if unknown. */
export function getCall(callId) {
  const entry = calls.get(callId);
  return entry ? structuredClone(entry.state) : null;
}

export function _resetForTests() {
  for (const e of calls.values()) clearTimeout(e.timer);
  calls.clear();
}
