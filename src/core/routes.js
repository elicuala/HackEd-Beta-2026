// FOUNDATION: locked. Health check and the live Server-Sent Events stream.
import { subscribe } from "./bus.js";
import { getCall } from "./calls.js";

export default function register(app) {
  app.get("/api/health", (req, res) => res.json({ ok: true }));

  // GET /api/stream?callId=<id>   events: status | turn | action
  app.get("/api/stream", (req, res) => {
    const callId = String(req.query.callId ?? "");
    if (!callId || !getCall(callId)) {
      return res.status(404).json({ error: { code: "CALL_NOT_FOUND", message: "Unknown callId" } });
    }
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    const send = (kind, data) => res.write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
    send("status", { status: getCall(callId).status });
    const unsubscribe = subscribe(callId, (m) => send(m.kind, m.data));
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
}
