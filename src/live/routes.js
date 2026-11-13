// Owned by Agent B. Live board API (SPEC §5.11).
//   GET /api/live                     → [{ watchId, title, status, strikes, lastLine, ... }] newest first
//   GET /api/live/stream?watchId=     → SSE: snapshot, item, status, gone
import { listBoard, watch } from "./board.js";

const WATCH_ID_RE = /^[0-9a-f-]{36}$/i;

export default function register(app) {
  app.get("/api/live", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(listBoard());
  });

  app.get("/api/live/stream", (req, res) => {
    const watchId = String(req.query.watchId ?? "");
    let session = null;
    const send = (kind, data) => res.write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
    if (WATCH_ID_RE.test(watchId)) session = watch(watchId, (kind, data) => send(kind, data));
    if (!session) {
      return res.status(404).json({ error: { code: "DRILL_NOT_FOUND", message: "That drill isn't on the live board" } });
    }
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders();
    send("snapshot", session.snapshot);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(ping);
      session.unwatch();
    });
  });
}
