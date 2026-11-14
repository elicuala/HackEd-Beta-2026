// Agent B tests: phone drills (Twilio and OpenAI faked, no network).
import { test, describe, beforeEach, afterEach, after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import express from "express";
import register, { _markPlacedForTests } from "./routes.js";
import { bridgeCall } from "./bridge.js";
import { linearToMulaw, toneMulaw, toFrames } from "./mulaw.js";
import { allowedNumbers, phoneConfig, streamUrl } from "./config.js";
import { createCall, getCall, _resetForTests } from "../core/calls.js";
import { listBoard, watch, _resetBoardForTests } from "../live/board.js";

const ENV_KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "ALLOWED_NUMBERS", "PUBLIC_URL", "OPENAI_API_KEY"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function setPhoneEnv(on = true) {
  process.env.TWILIO_ACCOUNT_SID = on ? "AC_test" : "";
  process.env.TWILIO_AUTH_TOKEN = on ? "tok_test" : "";
  process.env.TWILIO_FROM_NUMBER = on ? "+15550000000" : "";
  process.env.ALLOWED_NUMBERS = on ? "+15551231234, +447700900123, not-a-number" : "";
  process.env.PUBLIC_URL = on ? "https://drill.example.app/" : "";
}
after(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  _resetForTests();
  _resetBoardForTests();
});

// ---------------------------------------------------------------- audio

describe("mulaw", () => {
  test("silence and extremes encode correctly", () => {
    assert.equal(linearToMulaw(0), 0xff);
    assert.equal(linearToMulaw(32767), 0x80);
    assert.equal(linearToMulaw(-32768), 0x00);
  });

  test("every ref sound becomes a short tone, unknown sounds become null", () => {
    for (const s of ["whistle", "red_card", "chime", "fanfare"]) {
      const buf = toneMulaw(s);
      assert.ok(buf.length > 800 && buf.length <= 8000, `${s}: ${buf.length} bytes`); // 0.1 s .. 1 s at 8 kHz
    }
    assert.equal(toneMulaw("buzzer"), null);
    assert.equal(toFrames(Buffer.alloc(400)).length, 3);
  });
});

// ---------------------------------------------------------------- config

describe("phone config", () => {
  test("numbers are masked and invalid ones are dropped", () => {
    setPhoneEnv(true);
    const cfg = phoneConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.publicUrl, "https://drill.example.app");
    assert.deepEqual(
      allowedNumbers(cfg).map(({ id, label }) => ({ id, label })),
      [{ id: "n1", label: "•••• 1234" }, { id: "n2", label: "•••• 0123" }]
    );
    assert.equal(streamUrl(cfg.publicUrl), "wss://drill.example.app/twilio/stream");
    setPhoneEnv(false);
    assert.equal(phoneConfig().enabled, false);
  });
});

// ---------------------------------------------------------------- routes

describe("phone routes", () => {
  let server;
  let base;
  let created;
  let validateResult;
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    register(app, {
      client: () => ({
        calls: {
          create: async (opts) => {
            created.push(opts);
            if (opts.to === "+447700900123") throw new Error("twilio down");
            return { sid: "CA123" };
          },
        },
      }),
      validateRequest: () => validateResult,
    });
    await new Promise((r) => {
      server = app.listen(0, "127.0.0.1", r);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());
  beforeEach(() => {
    created = [];
    validateResult = true;
  });
  afterEach(() => setPhoneEnv(false));

  const post = (path, body) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  test("not configured → 503 PHONE_DISABLED on both endpoints", async () => {
    setPhoneEnv(false);
    let res = await fetch(`${base}/api/phone/numbers`);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, "PHONE_DISABLED");
    res = await post("/api/phone/start", { numberId: "n1", scenarioId: "cra" });
    assert.equal(res.status, 503);
  });

  test("numbers never include the full number", async () => {
    setPhoneEnv(true);
    const res = await fetch(`${base}/api/phone/numbers`);
    const text = await res.text();
    assert.ok(!text.includes("5551231234"));
    assert.deepEqual(JSON.parse(text)[0], { id: "n1", label: "•••• 1234" });
  });

  test("start: validates, 403 for unknown numbers, places the call, shares on request", async () => {
    setPhoneEnv(true);
    assert.equal((await post("/api/phone/start", { numberId: "x", scenarioId: "cra" })).status, 400);
    const forbidden = await post("/api/phone/start", { numberId: "n9", scenarioId: "cra" });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error.code, "NUMBER_NOT_ALLOWED");
    assert.equal((await post("/api/phone/start", { numberId: "n1", scenarioId: "nope" })).status, 404);
    assert.equal(created.length, 0);

    const res = await post("/api/phone/start", { numberId: "n1", scenarioId: "cra", shareLive: true });
    assert.equal(res.status, 200);
    const { callId, watchId } = await res.json();
    assert.equal(getCall(callId).channel, "phone");
    assert.ok(watchId);
    assert.equal(created[0].to, "+15551231234");
    assert.equal(created[0].from, "+15550000000");
    assert.equal(created[0].url, `https://drill.example.app/twilio/voice?callId=${callId}`);
    // Trial Twilio accounts reject calls that set extra parameters such as `method`.
    assert.deepEqual(Object.keys(created[0]).sort(), ["from", "to", "url"]);
    assert.ok(watch(watchId, () => {}), "shared on the board (listed once the call starts)");
  });

  test("start: Twilio failure → 502 UPSTREAM_ERROR and the call leaves the board", async () => {
    setPhoneEnv(true);
    const res = await post("/api/phone/start", { numberId: "n2", scenarioId: "cra", shareLive: true });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, "UPSTREAM_ERROR");
    assert.equal(listBoard().length, 0);
    assert.equal(created.length, 1);
  });

  test("twilio/voice: bad signature → 403; good → Connect/Stream with the callId parameter", async () => {
    setPhoneEnv(true);
    const { callId } = createCall({ scenarioId: "cra", channel: "phone" });
    _markPlacedForTests(callId, "CA1");
    const form = (q) =>
      fetch(`${base}/twilio/voice?callId=${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "sig" },
        body: "CallSid=CA1",
      });
    validateResult = false;
    assert.equal((await form(callId)).status, 403);
    validateResult = true;
    let xml = await (await form(callId)).text();
    assert.match(xml, /<Connect><Stream url="wss:\/\/drill\.example\.app\/twilio\/stream">/);
    assert.match(xml, new RegExp(`<Parameter name="callId" value="${callId}"/>`));
    xml = await (await form("unknown")).text();
    assert.match(xml, /<Hangup\/>/);
  });
});

// ---------------------------------------------------------------- bridge

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
    this.closed = false;
  }
  send(s) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  in(obj) {
    this.emit("message", Buffer.from(JSON.stringify(obj)));
  }
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function setupBridge({ expect = true } = {}) {
  process.env.OPENAI_API_KEY = "sk-test";
  const { callId } = createCall({ scenarioId: "cra", channel: "phone" });
  const tw = new FakeSocket();
  const oa = new FakeSocket();
  const hangups = [];
  const bridge = bridgeCall(tw, {
    expectCall: () => expect,
    hangup: async (sid) => hangups.push(sid),
    openRealtime: () => oa,
    timeouts: { response: 50, playback: 50 },
  });
  tw.in({ event: "start", start: { streamSid: "MZ1", callSid: "CA1", customParameters: { callId } } });
  oa.emit("open");
  // Twilio echoes every mark once "played".
  const origSend = tw.send.bind(tw);
  tw.send = (s) => {
    origSend(s);
    const m = JSON.parse(s);
    if (m.event === "mark") setTimeout(() => tw.in({ event: "mark", mark: m.mark }), 1);
  };
  return { callId, tw, oa, hangups, bridge };
}

describe("phone bridge", () => {
  test("rejects streams that weren't placed by us", () => {
    const { tw, oa, bridge } = setupBridge({ expect: false });
    assert.equal(bridge.phase, "closed");
    assert.equal(tw.closed, true);
    assert.equal(oa.sent.length, 0);
  });

  test("session uses μ-law both ways, the scammer opens, and audio flows both ways", () => {
    const { tw, oa } = setupBridge();
    const update = oa.sent.find((e) => e.type === "session.update");
    assert.equal(update.session.audio.input.format.type, "audio/pcmu");
    assert.equal(update.session.audio.output.format.type, "audio/pcmu");
    assert.ok(update.session.audio.input.transcription.model);
    const open = oa.sent.find((e) => e.type === "response.create");
    assert.equal(open.response.metadata.kind, "opening");

    tw.in({ event: "media", media: { payload: "AAAA" } });
    assert.deepEqual(oa.sent.at(-1), { type: "input_audio_buffer.append", audio: "AAAA" });
    oa.in({ type: "response.created", response: { id: "r1", metadata: { kind: "opening" } } });
    oa.in({ type: "response.output_audio.delta", response_id: "r1", delta: "BBBB" });
    assert.deepEqual(tw.sent.at(-1), { event: "media", streamSid: "MZ1", media: { payload: "BBBB" } });
    oa.in({ type: "input_audio_buffer.speech_started" });
    assert.deepEqual(tw.sent.at(-1), { event: "clear", streamSid: "MZ1" }); // barge-in
  });

  test("a strike: whistle tone, the ref speaks out of band, caller audio paused meanwhile", async () => {
    const { tw, oa, callId } = setupBridge();
    oa.in({ type: "response.created", response: { id: "r1", metadata: { kind: "opening" } } });
    oa.in({ type: "response.output_audio_transcript.done", response_id: "r1", transcript: "Which bank do you use?" });
    oa.in({ type: "conversation.item.input_audio_transcription.completed", transcript: "I'm with TD." });
    await tick(10);
    const ref = oa.sent.find((e) => e.type === "response.create" && e.response.metadata?.kind === "ref");
    assert.ok(ref, "ref line requested");
    assert.equal(ref.response.conversation, "none");
    assert.match(ref.response.instructions, /Referee: Strike one/);
    assert.ok(tw.sent.some((m) => m.event === "media" && m.media.payload.length > 1000), "tone sent");

    const before = oa.sent.length;
    tw.in({ event: "media", media: { payload: "CCCC" } }); // ref speaking → not forwarded
    assert.equal(oa.sent.length, before);

    oa.in({ type: "response.created", response: { id: "ref1", metadata: ref.response.metadata } });
    oa.in({ type: "response.done", response: { id: "ref1", status: "completed" } });
    await tick(20);
    tw.in({ event: "media", media: { payload: "DDDD" } });
    assert.deepEqual(oa.sent.at(-1), { type: "input_audio_buffer.append", audio: "DDDD" });
    assert.equal(getCall(callId).strikes, 1);
  });

  test("autofail: red card, the unmask in the scammer's voice, then Twilio hangs up", async () => {
    const { tw, oa, hangups, callId } = setupBridge();
    oa.in({ type: "response.created", response: { id: "r1", metadata: null } });
    oa.in({ type: "response.output_audio_transcript.done", response_id: "r1", transcript: "Read me the gift card number." });
    oa.in({ type: "conversation.item.input_audio_transcription.completed", transcript: "It's 4512 3344 5566" });
    await tick(10);
    const unmask = oa.sent.find((e) => e.type === "response.create" && e.response.metadata?.kind === "unmask");
    assert.ok(unmask, "unmask requested");
    assert.match(unmask.response.instructions, /drop the act/);
    oa.in({ type: "response.created", response: { id: "u1", metadata: unmask.response.metadata } });
    oa.in({ type: "response.output_audio.delta", response_id: "u1", delta: "UUUU" });
    assert.deepEqual(tw.sent.filter((m) => m.event === "media").at(-1).media.payload, "UUUU");
    oa.in({ type: "response.done", response: { id: "u1", status: "completed" } });
    await tick(30);
    assert.deepEqual(hangups, ["CA1"]);
    assert.equal(getCall(callId).outcome, "failed_autofail");
    assert.equal(tw.closed && oa.closed, true);
  });

  test("the person hangs up mid-drill → passed, both sockets closed", async () => {
    const { tw, oa, callId, hangups } = setupBridge();
    tw.in({ event: "stop" });
    await tick(5);
    assert.equal(getCall(callId).outcome, "passed");
    assert.equal(oa.closed, true);
    assert.deepEqual(hangups, []);
  });
});
