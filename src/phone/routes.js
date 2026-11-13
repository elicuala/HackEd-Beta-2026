// Owned by Agent B. Phone drills through Twilio (SPEC §5.5, Part 2).
//   GET  /api/phone/numbers                        → [{ id, label }]  (503 PHONE_DISABLED if not configured)
//   POST /api/phone/start { numberId, scenarioId, shareLive? } → { callId, watchId }
//   POST /twilio/voice?callId=                     → TwiML <Connect><Stream> (signature-checked)
//   WS   /twilio/stream                            → bridge to OpenAI Realtime (attach)
import twilio from "twilio";
import { WebSocketServer } from "ws";
import { createCall, getCall } from "../core/calls.js";
import { getScenario } from "../scenarios/index.js";
import { shareCall, unshareCall } from "../live/board.js";
import { sendError, httpError, badRequest, requireScenarioId, upstreamError } from "../voice/validate.js";
import { phoneConfig, allowedNumbers, streamUrl } from "./config.js";
import { bridgeCall } from "./bridge.js";

const NUMBER_ID_RE = /^n\d{1,3}$/;
const PLACED_TTL_MS = 10 * 60 * 1000;

// callId → callSid for calls this server placed and hasn't bridged yet. Only these may open a stream.
const placed = new Map();

const phoneDisabled = () => httpError(503, "PHONE_DISABLED", "Phone drills aren't set up on this server");

function defaultClient(cfg) {
  return twilio(cfg.accountSid, cfg.authToken);
}

/**
 * @param deps test seam: { client(cfg) → twilio client, validateRequest(token, sig, url, params) → bool }
 */
export default function register(app, deps = {}) {
  const makeClient = deps.client ?? defaultClient;
  const validate = deps.validateRequest ?? twilio.validateRequest;

  app.get("/api/phone/numbers", (req, res) => {
    try {
      const cfg = phoneConfig();
      if (!cfg.enabled) throw phoneDisabled();
      res.set("Cache-Control", "no-store");
      res.json(allowedNumbers(cfg).map(({ id, label }) => ({ id, label })));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/phone/start", async (req, res) => {
    let callId = null;
    try {
      const cfg = phoneConfig();
      if (!cfg.enabled) throw phoneDisabled();
      const numberId = req.body?.numberId;
      if (typeof numberId !== "string" || !NUMBER_ID_RE.test(numberId)) throw badRequest("numberId must be like n1");
      const scenarioId = requireScenarioId(req.body);
      const target = allowedNumbers(cfg).find((n) => n.id === numberId);
      if (!target) throw httpError(403, "NUMBER_NOT_ALLOWED", "That number hasn't agreed to phone drills");
      getScenario(scenarioId); // 404 before we ring anyone

      callId = createCall({ scenarioId, channel: "phone" }).callId;
      const watchId = req.body.shareLive === true ? shareCall(callId) : null;
      let call;
      try {
        call = await makeClient(cfg).calls.create({
          to: target.number,
          from: cfg.fromNumber,
          url: `${cfg.publicUrl}/twilio/voice?callId=${encodeURIComponent(callId)}`,
          method: "POST",
        });
      } catch {
        throw upstreamError("Couldn't place the phone call", "twilio_create");
      }
      placed.set(callId, { callSid: call?.sid ?? null, at: Date.now() });
      res.json({ callId, watchId });
    } catch (err) {
      if (callId && !placed.has(callId)) unshareCall(callId);
      sendError(res, err);
    }
  });

  // Twilio fetches this when the person answers. Answer with a Media Stream back to us.
  app.post("/twilio/voice", (req, res) => {
    const cfg = phoneConfig();
    const signature = req.get("X-Twilio-Signature") ?? "";
    const url = `${cfg.publicUrl}${req.originalUrl}`;
    if (!cfg.enabled || !validate(cfg.authToken, signature, url, req.body ?? {})) {
      console.error("[phone] BAD_SIGNATURE");
      return res.status(403).type("text/plain").send("Forbidden");
    }
    const callId = String(req.query.callId ?? "");
    const vr = new twilio.twiml.VoiceResponse();
    const call = getCall(callId);
    if (!placed.has(callId) || !call || call.channel !== "phone" || call.status !== "live") {
      vr.hangup();
    } else {
      // Twilio drops query strings on stream URLs, so the callId travels as a custom parameter.
      vr.connect().stream({ url: streamUrl(cfg.publicUrl) }).parameter({ name: "callId", value: callId });
    }
    res.type("text/xml").send(vr.toString());
  });
}

/** Called by server.js with the raw http server. Handles WebSocket upgrades for /twilio/stream only. */
export function attach(server, deps = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const makeClient = deps.client ?? defaultClient;

  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      return;
    }
    if (pathname !== "/twilio/stream") return; // someone else's upgrade
    wss.handleUpgrade(req, socket, head, (ws) => {
      bridgeCall(ws, {
        openRealtime: deps.openRealtime,
        expectCall: (callId, callSid) => {
          const p = placed.get(callId);
          const ok = Boolean(p) && Date.now() - p.at < PLACED_TTL_MS && (!p.callSid || p.callSid === callSid);
          if (ok) placed.delete(callId); // one stream per call
          return ok;
        },
        hangup: async (callSid) => {
          await makeClient(phoneConfig()).calls(callSid).update({ status: "completed" });
        },
      });
    });
  });
  return wss;
}

/** Test helper: pretend /api/phone/start placed this call. */
export function _markPlacedForTests(callId, callSid) {
  placed.set(callId, { callSid, at: Date.now() });
}
