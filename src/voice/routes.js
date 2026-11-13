// Owned by Agent B. Browser voice API (SPEC §5.5). Calls run only through src/core/calls.js.
import { fileURLToPath } from "node:url";
import { createCall, processTurn, endCall, getCall } from "../core/calls.js";
import { getScenario } from "../scenarios/index.js";
import { mintClientSecret } from "./secret.js";
import {
  sendError,
  httpError,
  badRequest,
  requireScenarioId,
  requireCallId,
  requireTurn,
} from "./validate.js";

const DEV_PAGE = fileURLToPath(new URL("./dev.html", import.meta.url));

/** Browser routes may only drive browser calls (phone calls are driven by the Twilio bridge). */
function requireBrowserCall(callId) {
  const call = getCall(callId);
  if (!call || call.channel !== "browser") throw httpError(404, "CALL_NOT_FOUND", "Unknown callId");
}

/**
 * @param app   Express app
 * @param deps  test seam: { mint } replaces the OpenAI client-secret call
 */
export default function register(app, deps = {}) {
  const mint = deps.mint ?? mintClientSecret;

  app.post("/api/voice/session", async (req, res) => {
    try {
      const scenarioId = requireScenarioId(req.body);
      const scenario = getScenario(scenarioId); // 404 before we spend an upstream call
      const secret = await mint({ instructions: scenario.system_prompt });
      const { callId } = createCall({ scenarioId: scenario.id, channel: "browser" });
      res.set("Cache-Control", "no-store");
      res.json({
        callId,
        clientSecret: secret.value,
        model: secret.model,
        voice: secret.voice,
        openingLine: scenario.opening_line,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/voice/turn", async (req, res) => {
    try {
      const callId = requireCallId(req.body);
      const turn = requireTurn(req.body);
      requireBrowserCall(callId);
      res.json({ actions: await processTurn(callId, turn) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/voice/end", async (req, res) => {
    try {
      const callId = requireCallId(req.body);
      requireBrowserCall(callId);
      res.json({ actions: await endCall(callId) });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Malformed JSON bodies fail in express.json() before our handlers run. Scoped to /api/voice only.
  app.use("/api/voice", (err, req, res, next) => {
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      return sendError(res, badRequest("Request body must be valid JSON"));
    }
    next(err);
  });

  // Private test page for Agent B (not linked from the site). Disabled in production.
  app.get("/dev/voice", (req, res) => {
    if (process.env.NODE_ENV === "production") return res.status(404).end();
    res.set("Cache-Control", "no-store");
    res.sendFile(DEV_PAGE);
  });
}
