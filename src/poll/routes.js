// A fallback for the live call stream (/api/stream, Server-Sent Events) on networks that don't pass SSE through,
// notably Cloudflare's free quick tunnels. It keeps the recent events of each call in memory and serves them
// to plain GET requests:
//   GET /api/stream/poll?callId=<id>&after=<n>  →  { status, events: [{ n, kind, data }], next }
// kind and data are exactly what the SSE stream sends (status | turn | action), already redacted by the core.
import { subscribe } from "../core/bus.js";
import { getCall } from "../core/calls.js";

export const MAX_EVENTS_PER_CALL = 1000;
export const MAX_CALLS = 300;
const TTL_MS = 60 * 60 * 1000;

const logs = new Map(); // callId → { events: [{ n, kind, data }], n, at }
let recording = false;

function record() {
  if (recording) return;
  recording = true;
  // Recording from the start of the server (not from the first poll) means a dashboard that connects late still
  // gets the whole call.
  subscribe(null, (m) => {
    let log = logs.get(m.callId);
    if (!log) {
      log = { events: [], n: 0, at: Date.now() };
      logs.set(m.callId, log);
      while (logs.size > MAX_CALLS) logs.delete(logs.keys().next().value);
    }
    log.n += 1;
    log.at = Date.now();
    log.events.push({ n: log.n, kind: m.kind, data: m.data });
    if (log.events.length > MAX_EVENTS_PER_CALL) log.events.shift();
  });
  const sweep = setInterval(() => {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, log] of logs) if (log.at < cutoff) logs.delete(id);
  }, 10 * 60 * 1000);
  sweep.unref?.();
}

export default function register(app) {
  record();
  app.get("/api/stream/poll", (req, res) => {
    const callId = String(req.query.callId ?? "");
    const call = callId ? getCall(callId) : null;
    if (!call) {
      return res.status(404).json({ error: { code: "CALL_NOT_FOUND", message: "Unknown callId" } });
    }
    const after = Math.max(0, Number.parseInt(String(req.query.after ?? "0"), 10) || 0);
    const log = logs.get(callId);
    res.set("Cache-Control", "no-store");
    res.json({ status: call.status, events: log ? log.events.filter((e) => e.n > after) : [], next: log?.n ?? 0 });
  });
}

/** Test helper. */
export function _resetPollForTests() {
  logs.clear();
}
