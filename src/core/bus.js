// FOUNDATION: locked. In-process pub/sub for live call updates (feeds GET /api/stream).
import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(200);

/** kind: "status" | "turn" | "action". data must already be redacted. */
export function publish(callId, kind, data) {
  bus.emit("msg", { callId, kind, data });
}

/** Subscribe to one call (or all calls if callId is null). Returns an unsubscribe function. */
export function subscribe(callId, fn) {
  const handler = (m) => {
    if (!callId || m.callId === callId) fn(m);
  };
  bus.on("msg", handler);
  return () => bus.off("msg", handler);
}
