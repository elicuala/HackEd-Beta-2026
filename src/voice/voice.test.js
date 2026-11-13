// Agent B tests: voice routes (OpenAI mocked, no network) and the browser voice client (fake WebRTC).
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import register from "./routes.js";
import { mintClientSecret } from "./secret.js";
import { CLIENT_SECRETS_URL } from "./config.js";
import { createCall, getCall, _resetForTests } from "../core/calls.js";
import { createVoiceClient } from "../../public/js/voice-client.js";

// ---------------------------------------------------------------- routes

function startApp(deps) {
  const app = express();
  app.use(express.json());
  register(app, deps);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, base });
    });
  });
}

const post = (base, path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("voice routes", () => {
  let app;
  let mintCalls;
  let mintImpl;
  const savedKey = process.env.OPENAI_API_KEY;

  before(async () => {
    app = await startApp({
      mint: async (args) => {
        mintCalls.push(args);
        return mintImpl(args);
      },
    });
  });
  after(() => {
    app.server.close();
    process.env.OPENAI_API_KEY = savedKey ?? "";
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  });
  beforeEach(() => {
    _resetForTests();
    mintCalls = [];
    mintImpl = async () => ({ value: "ek_test", expiresAt: 1, model: "m", voice: "v" });
  });

  test("session: returns the contract shape, no-store, and a browser call", async () => {
    const res = await post(app.base, "/api/voice/session", { scenarioId: "cra" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ["callId", "clientSecret", "model", "openingLine", "voice"]);
    assert.equal(body.clientSecret, "ek_test");
    assert.ok(body.openingLine.length > 0);
    assert.equal(getCall(body.callId).channel, "browser");
    assert.match(mintCalls[0].instructions, /scammer/i); // scenario.system_prompt is passed through
  });

  test("session: bad body → 400, unknown scenario → 404 without calling OpenAI", async () => {
    for (const body of [{}, { scenarioId: 5 }, { scenarioId: "../etc" }, "not json"]) {
      const res = await post(app.base, "/api/voice/session", body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal((await res.json()).error.code, "BAD_REQUEST");
    }
    const res = await post(app.base, "/api/voice/session", { scenarioId: "nope" });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, "SCENARIO_NOT_FOUND");
    assert.equal(mintCalls.length, 0);
  });

  test("session: upstream failure → 502 UPSTREAM_ERROR in the SPEC error shape", async () => {
    mintImpl = async () => {
      const e = new Error("The voice service refused the session");
      Object.assign(e, { status: 502, code: "UPSTREAM_ERROR", expose: true });
      throw e;
    };
    const res = await post(app.base, "/api/voice/session", { scenarioId: "cra" });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error.code, "UPSTREAM_ERROR");
    assert.equal(typeof body.error.message, "string");
  });

  test("turn: validates, runs through the core, and reveals on 'stop'", async () => {
    const { callId } = createCall({ scenarioId: "cra", channel: "browser" });
    const bad = [
      {},
      { callId },
      { callId, turn: { speaker: "ref", text: "x", t: 0 } },
      { callId, turn: { speaker: "victim", text: "x", t: -1 } },
      { callId, turn: { speaker: "victim", text: "x".repeat(2001), t: 1 } },
    ];
    for (const body of bad) {
      const res = await post(app.base, "/api/voice/turn", body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    }
    let res = await post(app.base, "/api/voice/turn", { callId, turn: { speaker: "victim", text: "hello", t: 1 } });
    assert.deepEqual(await res.json(), { actions: [] });
    res = await post(app.base, "/api/voice/turn", { callId, turn: { speaker: "victim", text: "Stop.", t: 2 } });
    const { actions } = await res.json();
    assert.equal(actions[0].type, "reveal");
    assert.equal(actions[0].outcome, "passed");
  });

  test("turn and end: unknown or phone calls → 404 CALL_NOT_FOUND", async () => {
    const phone = createCall({ scenarioId: "cra", channel: "phone" }).callId;
    for (const callId of ["00000000-0000-4000-8000-000000000000", phone]) {
      let res = await post(app.base, "/api/voice/turn", { callId, turn: { speaker: "victim", text: "x", t: 0 } });
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error.code, "CALL_NOT_FOUND");
      res = await post(app.base, "/api/voice/end", { callId });
      assert.equal(res.status, 404);
    }
  });

  test("end: reveals passed once, then returns []", async () => {
    const { callId } = createCall({ scenarioId: "cra", channel: "browser" });
    let res = await post(app.base, "/api/voice/end", { callId });
    const first = await res.json();
    assert.equal(first.actions[0].outcome, "passed");
    res = await post(app.base, "/api/voice/end", { callId });
    assert.deepEqual(await res.json(), { actions: [] });
  });

  test("dev page is served", async () => {
    const res = await fetch(app.base + "/dev/voice");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /voice-client\.js/);
  });

  test("with OPENAI_API_KEY blank, the real route answers 502 UPSTREAM_ERROR", async () => {
    process.env.OPENAI_API_KEY = "";
    const real = await startApp({});
    try {
      const res = await post(real.base, "/api/voice/session", { scenarioId: "cra" });
      assert.equal(res.status, 502);
      assert.equal((await res.json()).error.code, "UPSTREAM_ERROR");
    } finally {
      real.server.close();
    }
  });
});

// ---------------------------------------------------------------- mintClientSecret

describe("mintClientSecret", () => {
  const savedKey = process.env.OPENAI_API_KEY;
  after(() => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });

  test("sends a GA realtime session with transcription and returns the secret", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ value: "ek_abc", expires_at: 123 }) };
    };
    const out = await mintClientSecret({ instructions: "be a scammer" }, { fetchImpl });
    assert.equal(seen.url, CLIENT_SECRETS_URL);
    assert.equal(seen.init.headers.Authorization, "Bearer sk-test-key");
    const s = seen.body.session;
    assert.equal(s.type, "realtime");
    assert.equal(s.instructions, "be a scammer");
    assert.ok(s.model && s.audio.output.voice);
    assert.ok(s.audio.input.transcription.model);
    assert.equal(s.audio.input.turn_detection.interrupt_response, true);
    assert.equal(seen.body.expires_after.anchor, "created_at");
    assert.deepEqual(out, { value: "ek_abc", expiresAt: 123, model: s.model, voice: s.audio.output.voice });
  });

  test("missing key, HTTP error, network error, and bad body all become UPSTREAM_ERROR without leaking the key", async () => {
    process.env.OPENAI_API_KEY = "";
    await assert.rejects(mintClientSecret({ instructions: "x" }, { fetchImpl: async () => assert.fail() }), {
      code: "UPSTREAM_ERROR",
      status: 502,
    });
    process.env.OPENAI_API_KEY = "sk-secret-123";
    const cases = [
      async () => ({ ok: false, status: 401, json: async () => ({}) }),
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }),
      async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } }),
    ];
    for (const fetchImpl of cases) {
      await assert.rejects(mintClientSecret({ instructions: "x" }, { fetchImpl }), (err) => {
        assert.equal(err.code, "UPSTREAM_ERROR");
        assert.ok(!err.message.includes("sk-secret"));
        return true;
      });
    }
  });
});

// ---------------------------------------------------------------- browser voice client (fake WebRTC)

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function fakeEnv({ sessionStatus = 200, micDenied = false, turnActions = () => [], endActions = () => [] } = {}) {
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const dc = {
    readyState: "connecting",
    sent: [],
    send(s) { this.sent.push(JSON.parse(s)); },
    close() { this.readyState = "closed"; },
  };
  const pcs = [];
  class FakePC {
    constructor() { this.closed = false; this.connectionState = "new"; pcs.push(this); }
    addTrack() {}
    createDataChannel(name) { assert.equal(name, "oai-events"); return dc; }
    async createOffer() { return { type: "offer", sdp: "v=0 offer" }; }
    async setLocalDescription() {}
    async setRemoteDescription(d) {
      assert.equal(d.sdp, "v=0 answer");
      setTimeout(() => { dc.readyState = "open"; dc.onopen?.(); }, 1);
    }
    close() { this.closed = true; }
  }
  class FakeAudio { constructor() { this.muted = false; this.srcObject = null; } pause() {} }
  const posts = [];
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => "" });
  const fetch = async (url, init) => {
    if (url === "https://realtime.test/calls") {
      assert.equal(init.headers.Authorization, "Bearer ek_test");
      assert.equal(init.headers["Content-Type"], "application/sdp");
      return { ok: true, status: 201, text: async () => "v=0 answer" };
    }
    const body = JSON.parse(init.body);
    posts.push({ url, body });
    if (url === "/api/voice/session") {
      if (sessionStatus !== 200) return json(sessionStatus, { error: { code: "UPSTREAM_ERROR", message: "x" } });
      return json(200, { callId: "call-1", clientSecret: "ek_test", model: "m", voice: "v", openingLine: "Hello, this is the tax office." });
    }
    if (url === "/api/voice/turn") return json(200, { actions: turnActions(body.turn) });
    if (url === "/api/voice/end") return json(200, { actions: endActions() });
    return json(404, { error: { code: "NOT_FOUND" } });
  };
  const log = { status: [], turns: [], actions: [], errors: [] };
  const handlers = {
    onStatus: (s) => log.status.push(s),
    onTurn: (t) => log.turns.push(t),
    onActions: (a) => log.actions.push(...a),
    onError: (e) => log.errors.push(e),
  };
  let micConstraints;
  const deps = {
    fetch,
    getUserMedia: async (c) => {
      micConstraints = c;
      if (micDenied) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      return stream;
    },
    RTCPeerConnection: FakePC,
    Audio: FakeAudio,
    realtimeUrl: "https://realtime.test/calls",
    revealCloseMs: 40,
    unmaskStartMs: 30,
    unmaskMaxMs: 200,
  };
  const emit = (ev) => dc.onmessage({ data: JSON.stringify(ev) });
  return { handlers, deps, log, dc, pcs, posts, track, emit, mic: () => micConstraints };
}

const reveal = (outcome = "failed_autofail") => ({
  type: "reveal", callId: "call-1", outcome, events: [], ref: { say: "This was a Scam Drill.", sound: "red_card" },
});

describe("voice client", () => {
  test("start: connecting → live, echo-cancelled mic, scammer opens with the opening line", async () => {
    const f = fakeEnv();
    const client = createVoiceClient(f.handlers, f.deps);
    assert.deepEqual(await client.start("cra"), { callId: "call-1" });
    assert.deepEqual(f.log.status, ["connecting", "live"]);
    assert.equal(f.mic().audio.echoCancellation, true);
    const open = f.dc.sent.find((e) => e.type === "response.create");
    assert.equal(open.response.metadata.kind, "opening");
    assert.match(open.response.instructions, /Hello, this is the tax office\./);
  });

  test("turns: posted in order, redacted for the UI, victim dropped while the ref speaks", async () => {
    const f = fakeEnv();
    const client = createVoiceClient(f.handlers, f.deps);
    await client.start("cra");
    f.emit({ type: "response.created", response: { id: "r1", metadata: { kind: "opening" } } });
    f.emit({ type: "response.output_audio_transcript.done", response_id: "r1", transcript: "Hello, this is the tax office." });
    f.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "My card is 4512" });
    f.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "   " });
    client.setRefSpeaking(true);
    assert.equal(f.track.enabled, false);
    assert.equal(f.log.status.at(-1), "ref_speaking");
    f.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "ignored while ref talks" });
    client.setRefSpeaking(false);
    assert.equal(f.track.enabled, true);
    await tick(10);
    const turns = f.posts.filter((p) => p.url === "/api/voice/turn").map((p) => p.body.turn);
    assert.deepEqual(turns.map((t) => [t.speaker, t.text]), [
      ["scammer", "Hello, this is the tax office."],
      ["victim", "My card is 4512"], // RAW to the server (rules need digits)
    ]);
    assert.equal(f.log.turns[1].text, "My card is ••••"); // redacted for the UI
    assert.ok(turns.every((t) => typeof t.t === "number" && t.t >= 0));
  });

  test("scammer_speaking follows output audio, and pause/resume cancels and re-asks", async () => {
    const f = fakeEnv();
    const client = createVoiceClient(f.handlers, f.deps);
    await client.start("cra");
    f.emit({ type: "response.created", response: { id: "r2", metadata: null } });
    f.emit({ type: "output_audio_buffer.started", response_id: "r2" });
    assert.equal(f.log.status.at(-1), "scammer_speaking");
    client.pauseScammer();
    const sentTypes = f.dc.sent.map((e) => e.type);
    assert.ok(sentTypes.includes("response.cancel") && sentTypes.includes("output_audio_buffer.clear"));
    f.emit({ type: "output_audio_buffer.cleared", response_id: "r2" });
    assert.equal(f.log.status.at(-1), "live");
    f.emit({ type: "response.created", response: { id: "r3" } }); // VAD reply while paused → cancelled
    assert.deepEqual(f.dc.sent.at(-1), { type: "response.cancel", response_id: "r3" });
    f.dc.sent.length = 0;
    client.resumeScammer();
    assert.deepEqual(f.dc.sent, [{ type: "response.create", response: { metadata: { kind: "reply" } } }]);
  });

  test("reveal → mic stops at once, unmask speaks in the scammer voice, then ended", async () => {
    const f = fakeEnv({ turnActions: (t) => (/4512/.test(t.text) ? [reveal()] : []) });
    const client = createVoiceClient(f.handlers, f.deps);
    await client.start("cra");
    f.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "it's 4512" });
    await tick(10);
    assert.equal(f.log.actions[0].type, "reveal");
    assert.equal(f.track.stopped, true);
    assert.notEqual(f.log.status.at(-1), "ended"); // still open for the unmask

    const p = client.unmask("This was a Scam Drill.");
    assert.equal(client.unmask("again"), p); // idempotent
    const req = f.dc.sent.filter((e) => e.type === "response.create").at(-1);
    assert.equal(req.response.metadata.kind, "unmask");
    assert.match(req.response.instructions, /out of character/);
    f.emit({ type: "response.created", response: { id: "u1", metadata: { kind: "unmask" } } });
    f.emit({ type: "output_audio_buffer.started", response_id: "u1" });
    f.emit({ type: "response.output_audio_transcript.done", response_id: "u1", transcript: "This was a Scam Drill." });
    f.emit({ type: "output_audio_buffer.stopped", response_id: "u1" });
    assert.equal(await p, true);
    assert.equal(f.log.status.at(-1), "ended");
    assert.equal(f.pcs[0].closed, true);
    const turnTexts = f.posts.filter((x) => x.url === "/api/voice/turn").map((x) => x.body.turn.text);
    assert.ok(!turnTexts.includes("This was a Scam Drill.")); // the unmask is never a Turn
  });

  test("unmask resolves false fast when no audio starts, and the call still ends", async () => {
    const f = fakeEnv({ endActions: () => [reveal("passed")] });
    const client = createVoiceClient(f.handlers, f.deps);
    await client.start("cra");
    await client.end();
    assert.equal(f.log.actions[0].outcome, "passed");
    assert.equal(await client.unmask("This was a Scam Drill."), false);
    assert.equal(f.log.status.at(-1), "ended");
  });

  test("without unmask, everything closes after the reveal timeout", async () => {
    const f = fakeEnv({ endActions: () => [reveal("passed")] });
    const client = createVoiceClient(f.handlers, f.deps);
    await client.start("cra");
    await client.end();
    assert.notEqual(f.log.status.at(-1), "ended");
    await tick(60);
    assert.equal(f.log.status.at(-1), "ended");
    assert.equal(await client.unmask("late"), false);
  });

  test("mic denied → MIC_DENIED; session 502 → UPSTREAM_ERROR and the mic is released", async () => {
    let f = fakeEnv({ micDenied: true });
    let client = createVoiceClient(f.handlers, f.deps);
    await assert.rejects(client.start("cra"), { code: "MIC_DENIED" });
    assert.deepEqual(f.log.errors.map((e) => e.code), ["MIC_DENIED"]);
    assert.equal(f.log.status.at(-1), "ended");

    f = fakeEnv({ sessionStatus: 502 });
    client = createVoiceClient(f.handlers, f.deps);
    await assert.rejects(client.start("cra"), { code: "UPSTREAM_ERROR" });
    await tick(5);
    assert.equal(f.track.stopped, true);
    assert.equal(f.log.errors.length, 1);
  });

  test("a dropped data channel mid-call → CONNECTION_LOST once", async () => {
    const f = fakeEnv();
    const client = createVoiceClient(f.handlers, f.deps);
    await client.start("cra");
    f.dc.onclose();
    f.dc.onclose();
    assert.deepEqual(f.log.errors.map((e) => e.code), ["CONNECTION_LOST"]);
    assert.equal(f.log.status.at(-1), "ended");
  });
});
