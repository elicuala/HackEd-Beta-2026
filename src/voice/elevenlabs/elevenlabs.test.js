// ElevenLabs scammer: routes and config, with every ElevenLabs call faked (no network).
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import register from "../routes.js";
import { createCall, processTurn, endCall, _resetForTests } from "../../core/calls.js";
import { elevenAgentFor, conversationToken, speak } from "./service.js";
import { SCENARIO_VOICES } from "./config.js";
import { listScenarios } from "../../scenarios/index.js";

const AGENT = { agentId: "agent_test", voiceId: "voice_test" };

async function startApp(eleven) {
  const app = express();
  app.use(express.json());
  register(app, { mint: async () => assert.fail("OpenAI must not be called"), eleven });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { server, base, post };
}

describe("elevenlabs routes", () => {
  let app;
  let spoken;
  let tokenCalls;
  before(async () => {
    app = await startApp({
      agentFor: () => AGENT,
      token: async (agentId) => (tokenCalls.push(agentId), "conv_token"),
      speak: async (text, voiceId) => (spoken.push({ text, voiceId }), Buffer.from("ID3fake-mp3")),
    });
  });
  after(() => app.server.close());
  beforeEach(() => {
    _resetForTests();
    spoken = [];
    tokenCalls = [];
  });

  test("session: hands the browser a conversation token, never a key", async () => {
    const res = await app.post("/api/voice/session", { scenarioId: "cra" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.provider, "elevenlabs");
    assert.equal(body.conversationToken, "conv_token");
    assert.equal(body.clientSecret, null);
    assert.ok(body.callId && body.openingLine);
    assert.deepEqual(tokenCalls, ["agent_test"]);
    assert.ok(!JSON.stringify(body).includes(process.env.ELEVENLABS_API_KEY || "no-key-set"));
  });

  test("unmask: speaks the line in the scammer's voice, once, only after the reveal", async () => {
    const { callId } = createCall({ scenarioId: "cra", channel: "browser" });
    let res = await app.post("/api/voice/unmask", { callId, text: "This was a Loki drill." });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, "NOT_REVEALED");

    await endCall(callId);
    res = await app.post("/api/voice/unmask", { callId, text: "This was a Loki drill." });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/mpeg");
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "ID3fake-mp3");
    assert.deepEqual(spoken, [{ text: "This was a Loki drill.", voiceId: "voice_test" }]);

    res = await app.post("/api/voice/unmask", { callId, text: "again" });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, "ALREADY_UNMASKED");
  });

  test("unmask: bad input and unknown or phone calls are refused", async () => {
    const { callId } = createCall({ scenarioId: "cra", channel: "browser" });
    await processTurn(callId, { speaker: "victim", text: "stop", t: 1 });
    for (const body of [{ callId, text: "" }, { callId, text: 5 }, { callId, text: "x".repeat(601) }, { text: "hi" }]) {
      const res = await app.post("/api/voice/unmask", body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await app.post("/api/voice/unmask", { callId: "nope", text: "hi" })).status, 404);
    const phone = createCall({ scenarioId: "cra", channel: "phone" });
    assert.equal((await app.post("/api/voice/unmask", { callId: phone.callId, text: "hi" })).status, 404);
    assert.equal(spoken.length, 0);
  });

  test("the browser client module is served without a build step", async () => {
    const res = await fetch(app.base + "/vendor/elevenlabs-client.mjs");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /javascript/);
    const js = await res.text();
    assert.match(js, /export const Conversation = ElevenLabsClient\.Conversation;\s*$/);
  });
});

describe("elevenlabs routes: upstream failure", () => {
  test("a token failure is a 502 and creates no call", async () => {
    const app = await startApp({
      agentFor: () => AGENT,
      token: async () => conversationToken("x", { api: { conversationalAi: { conversations: { getWebrtcToken: async () => { throw Object.assign(new Error("no"), { statusCode: 401 }); } } } } }),
    });
    try {
      const res = await app.post("/api/voice/session", { scenarioId: "cra" });
      assert.equal(res.status, 502);
      assert.equal((await res.json()).error.code, "UPSTREAM_ERROR");
    } finally {
      app.server.close();
    }
  });
});

test("agentFor: only the scenarios ElevenLabs is allowed to play use it (bank stays on OpenAI by default)", async () => {
  const { elevenScenarios, DEFAULT_ELEVEN_SCENARIOS } = await import("./config.js");
  const agents = { cra: AGENT, grandkid: AGENT, bank_fraud: AGENT };
  const on = { provider: "elevenlabs", apiKey: "k", scenarios: DEFAULT_ELEVEN_SCENARIOS };
  assert.deepEqual(DEFAULT_ELEVEN_SCENARIOS, ["cra", "grandkid"]);
  assert.deepEqual(elevenAgentFor("cra", { agents, cfg: on }), AGENT);
  assert.deepEqual(elevenAgentFor("grandkid", { agents, cfg: on }), AGENT);
  assert.equal(elevenAgentFor("bank_fraud", { agents, cfg: on }), null);
  assert.deepEqual(elevenAgentFor("bank_fraud", { agents, cfg: { ...on, scenarios: null } }), AGENT);
  assert.equal(elevenScenarios(undefined).join(), "cra,grandkid");
  assert.equal(elevenScenarios(" ").join(), "cra,grandkid");
  assert.equal(elevenScenarios("all"), null);
  assert.equal(elevenScenarios("CRA, bank_fraud").join(), "cra,bank_fraud");
});

test("agentFor: needs the provider, a key, and a set-up agent", () => {
  const agents = { cra: AGENT };
  const on = { provider: "elevenlabs", apiKey: "k" };
  assert.deepEqual(elevenAgentFor("cra", { agents, cfg: on }), AGENT);
  assert.equal(elevenAgentFor("grandkid", { agents, cfg: on }), null);
  assert.equal(elevenAgentFor("cra", { agents, cfg: { ...on, apiKey: "" } }), null);
  assert.equal(elevenAgentFor("cra", { agents, cfg: { ...on, provider: "openai" } }), null);
  assert.equal(elevenAgentFor("cra", { agents: { cra: { agentId: "a" } }, cfg: on }), null);
});

test("speak: joins the audio stream into one buffer", async () => {
  async function* chunks() {
    yield new Uint8Array([1, 2]);
    yield new Uint8Array([3]);
  }
  const calls = [];
  const api = { textToSpeech: { convert: async (voiceId, body) => (calls.push({ voiceId, body }), chunks()) } };
  const buf = await speak("hello", "v1", { api });
  assert.deepEqual([...buf], [1, 2, 3]);
  assert.equal(calls[0].voiceId, "v1");
  assert.equal(calls[0].body.text, "hello");
});

test("every scenario has a scammer voice", () => {
  for (const { id } of listScenarios()) assert.ok(SCENARIO_VOICES[id]?.voiceId, id);
});
