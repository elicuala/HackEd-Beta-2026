// Owned by Agent B. Request validation and SPEC §5.5 error helpers. Logs codes only, never bodies.
import { validateTurn } from "../shared/contract.js";

export const MAX_TURN_CHARS = 2000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.expose = true;
  return err;
}

export const badRequest = (message) => httpError(400, "BAD_REQUEST", message);

/** detail is a short machine reason for the log (never a body or a key). */
export function upstreamError(message, detail = "") {
  const err = httpError(502, "UPSTREAM_ERROR", message);
  err.detail = detail;
  return err;
}

/** Send any error in the SPEC shape. Unknown errors become a generic 500. */
export function sendError(res, err) {
  const known = err && err.expose && typeof err.code === "string";
  const status = known ? err.status || 500 : 500;
  const code = known ? err.code : "INTERNAL";
  console.error(`[voice] ${code}${err?.detail ? ` (${err.detail})` : ""}`);
  res.status(status).json({ error: { code, message: known ? err.message : "Internal error" } });
}

export function requireScenarioId(body) {
  const id = body?.scenarioId;
  if (typeof id !== "string" || !ID_RE.test(id)) throw badRequest("scenarioId must be a short id string");
  return id;
}

export function requireCallId(body) {
  const id = body?.callId;
  if (typeof id !== "string" || !ID_RE.test(id)) throw badRequest("callId must be a call id string");
  return id;
}

/** Returns a clean Turn with only the contract fields. */
export function requireTurn(body) {
  const turn = body?.turn;
  const { ok } = validateTurn(turn);
  if (!ok) throw badRequest("turn must be { speaker, text, t }");
  if (turn.text.length > MAX_TURN_CHARS) throw badRequest("turn text is too long");
  if (!Number.isFinite(turn.t) || turn.t < 0) throw badRequest("turn t must be seconds since the call started");
  return { speaker: turn.speaker, text: turn.text, t: turn.t };
}
