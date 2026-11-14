// Owned by Agent B. Browser voice API (SPEC §5.5). Calls run only through src/core/calls.js.
import { fileURLToPath } from "node:url";
import { createCall, processTurn, endCall, getCall } from "../core/calls.js";
import { getScenario } from "../scenarios/index.js";
import { mintClientSecret } from "./secret.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { elevenAgentFor, conversationToken, speak } from "./elevenlabs/service.js";
import { UNMASK_MAX_CHARS } from "./elevenlabs/config.js";
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
 * @param deps  test seam: { mint } replaces the OpenAI client-secret call; { eleven } replaces the ElevenLabs calls
 */
export default function register(app, deps = {}) {
  const mint = deps.mint ?? mintClientSecret;
  const eleven = { agentFor: elevenAgentFor, token: conversationToken, speak, ...deps.eleven };
  const unmasked = new Set(); // one unmask per call

  app.post("/api/voice/session", async (req, res) => {
    try {
      const scenarioId = requireScenarioId(req.body);
      const scenario = getScenario(scenarioId); // 404 before we spend an upstream call
      // ElevenLabs plays the scammer when it's set up for this scenario; otherwise OpenAI Realtime does.
      const agent = eleven.agentFor(scenario.id);
      const upstream = agent
        ? { provider: "elevenlabs", conversationToken: await eleven.token(agent.agentId), clientSecret: null, model: "elevenlabs", voice: agent.voiceId }
        : await mint({ instructions: scenario.system_prompt, scenarioId: scenario.id }).then((secret) => ({
            provider: "openai",
            clientSecret: secret.value,
            model: secret.model,
            voice: secret.voice,
          }));
      const { callId } = createCall({ scenarioId: scenario.id, channel: "browser" });
      res.set("Cache-Control", "no-store");
      res.json({ callId, ...upstream, openingLine: scenario.opening_line });
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

  // The unmask line, spoken by the scammer's own ElevenLabs voice once the drill is over (SPEC §5.7).
  app.post("/api/voice/unmask", async (req, res) => {
    try {
      const callId = requireCallId(req.body);
      requireBrowserCall(callId);
      const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
      if (!text || text.length > UNMASK_MAX_CHARS) throw badRequest("text must be the unmask line");
      const call = getCall(callId);
      if (call.status !== "reveal") throw httpError(409, "NOT_REVEALED", "The drill isn't over yet");
      const agent = eleven.agentFor(call.scenarioId);
      if (!agent) throw httpError(404, "UNMASK_UNAVAILABLE", "No ElevenLabs voice for this call");
      if (unmasked.has(callId)) throw httpError(409, "ALREADY_UNMASKED", "This call was already unmasked");
      unmasked.add(callId);
      const audio = await eleven.speak(text, agent.voiceId);
      res.set("Cache-Control", "no-store");
      res.type("audio/mpeg").send(audio);
    } catch (err) {
      sendError(res, err);
    }
  });

  // The ElevenLabs browser client, served from node_modules as an ES module (no build step).
  let clientModule = null;
  app.get("/vendor/elevenlabs-client.mjs", (req, res) => {
    try {
      clientModule ??=
        readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve("@elevenlabs/client")), "lib.iife.js"), "utf8") +
        "\nexport const Conversation = ElevenLabsClient.Conversation;\n";
      res.set("Cache-Control", "public, max-age=3600");
      res.type("text/javascript").send(clientModule);
    } catch {
      res.status(404).end();
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
