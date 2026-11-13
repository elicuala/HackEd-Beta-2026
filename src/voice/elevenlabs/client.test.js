// The browser voice client's ElevenLabs path, with a fake ElevenLabs SDK, fake fetch, and fake audio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVoiceClient } from "../../../public/js/voice-client.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (fn, ms = 1000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup({ turnActions = () => [], startError = null, unmaskStatus = 200 } = {}) {
  const log = { statuses: [], turns: [], actions: [], errors: [], posted: [], conv: null, opts: null, audio: [] };
  const conv = {
    volume: 1,
    micMuted: false,
    ended: false,
    setVolume({ volume }) {
      this.volume = volume;
    },
    setMicMuted(m) {
      this.micMuted = m;
    },
    async endSession() {
      this.ended = true;
    },
  };
  log.conv = conv;
  const fakeSdk = {
    Conversation: {
      startSession: async (opts) => {
        log.opts = opts;
        if (startError) throw startError;
        opts.onMessage({ role: "agent", message: "Hello, this is Officer Grant." });
        return conv;
      },
    },
  };
  class FakeAudio {
    constructor(src) {
      this.src = src;
      log.audio.push(this);
    }
    async play() {
      this.onplaying?.();
      setTimeout(() => this.onended?.(), 5);
    }
    pause() {}
  }
  const fetch = async (path, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    log.posted.push({ path, body });
    if (path === "/api/voice/session")
      return json({ callId: "c1", provider: "elevenlabs", conversationToken: "tok", clientSecret: null, openingLine: "Hi", watchId: "w1" });
    if (path === "/api/voice/turn") return json({ actions: turnActions(body.turn) });
    if (path === "/api/voice/end") return json({ actions: [{ type: "reveal", outcome: "passed", ref: { say: "x" } }] });
    if (path === "/api/voice/unmask") return new Response(new Blob(["mp3"], { type: "audio/mpeg" }), { status: unmaskStatus });
    return json({ error: { code: "NOT_FOUND" } }, 404);
  };
  const client = createVoiceClient(
    {
      onStatus: (s) => log.statuses.push(s),
      onTurn: (t) => log.turns.push(t),
      onActions: (a) => log.actions.push(...a),
      onError: (e) => log.errors.push(e.code),
    },
    {
      fetch,
      getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [] }),
      RTCPeerConnection: function () {
        throw new Error("OpenAI WebRTC must not be used");
      },
      Audio: FakeAudio,
      loadElevenLabs: async () => fakeSdk,
      revealCloseMs: 2000,
      unmaskMaxMs: 1000,
      elevenUnmaskStartMs: 500,
    },
  );
  return { client, log, conv };
}

test("elevenlabs: starts with the server's token and posts the opening line as a scammer turn", async () => {
  const { client, log } = setup();
  assert.deepEqual(await client.start("cra"), { callId: "c1", watchId: "w1" });
  assert.equal(log.opts.conversationToken, "tok");
  assert.equal(log.opts.connectionType, "webrtc");
  assert.deepEqual(log.statuses, ["connecting", "live"]);
  await until(() => log.posted.some((p) => p.path === "/api/voice/turn"));
  const turn = log.posted.find((p) => p.path === "/api/voice/turn").body;
  assert.equal(turn.callId, "c1");
  assert.equal(turn.turn.speaker, "scammer");
  assert.equal(turn.turn.text, "Hello, this is Officer Grant.");
});

test("elevenlabs: victim lines go to the ref, digits are redacted for the UI, and speaking status follows the agent", async () => {
  const { client, log } = setup();
  await client.start("cra");
  log.opts.onMessage({ role: "user", message: "my pin is 1234" });
  await until(() => log.turns.length === 2);
  assert.equal(log.turns[1].text, "my pin is ••••");
  const raw = log.posted.filter((p) => p.path === "/api/voice/turn").at(-1).body.turn.text;
  assert.equal(raw, "my pin is 1234"); // the server's rules need the real digits
  log.opts.onModeChange({ mode: "speaking" });
  log.opts.onModeChange({ mode: "listening" });
  assert.deepEqual(log.statuses.slice(-2), ["scammer_speaking", "live"]);
});

test("elevenlabs: while the ref speaks the mic is muted and the person's lines are dropped", async () => {
  const { client, log, conv } = setup();
  await client.start("cra");
  await until(() => log.turns.length === 1);
  client.setRefSpeaking(true);
  assert.equal(conv.micMuted, true);
  log.opts.onMessage({ role: "user", message: "this is the ref talking" });
  await tick();
  client.setRefSpeaking(false);
  assert.equal(conv.micMuted, false);
  assert.equal(log.turns.length, 1);
  client.pauseScammer();
  assert.equal(conv.volume, 0);
  client.resumeScammer();
  assert.equal(conv.volume, 1);
});

test("elevenlabs: a reveal stops the agent, then unmask plays the scammer's voice and ends the call", async () => {
  const { client, log, conv } = setup({
    turnActions: (t) => (t.speaker === "victim" ? [{ type: "reveal", outcome: "failed_autofail", ref: { say: "drop" } }] : []),
  });
  await client.start("cra");
  log.opts.onMessage({ role: "user", message: "the card is 4512 3344" });
  await until(() => log.actions.some((a) => a.type === "reveal"));
  assert.equal(conv.ended, true);
  assert.equal(conv.micMuted, true);
  assert.equal(await client.unmask("Okay, I'll drop the act."), true);
  const posted = log.posted.find((p) => p.path === "/api/voice/unmask").body;
  assert.deepEqual(posted, { callId: "c1", text: "Okay, I'll drop the act." });
  assert.equal(log.audio.filter((a) => String(a.src).startsWith("blob:")).length, 1); // the unmask audio
  assert.equal(log.statuses.at(-1), "ended");
  assert.equal(await client.unmask("again"), true); // same promise, no second request
  assert.equal(log.posted.filter((p) => p.path === "/api/voice/unmask").length, 1);
});

test("elevenlabs: unmask resolves false when the server can't speak it, so the page falls back", async () => {
  const { client, log } = setup({ unmaskStatus: 502 });
  await client.start("cra");
  await client.end();
  assert.ok(log.actions.some((a) => a.type === "reveal"));
  assert.equal(await client.unmask("line"), false);
  assert.equal(log.statuses.at(-1), "ended");
});

test("elevenlabs: a denied microphone is reported as MIC_DENIED", async () => {
  const { client, log } = setup({ startError: Object.assign(new Error("denied"), { name: "NotAllowedError" }) });
  await assert.rejects(client.start("cra"), { code: "MIC_DENIED" });
  assert.deepEqual(log.errors, ["MIC_DENIED"]);
  assert.equal(log.statuses.at(-1), "ended");
});

test("elevenlabs: a dropped connection mid-call is CONNECTION_LOST", async () => {
  const { client, log } = setup();
  await client.start("cra");
  log.opts.onDisconnect({ reason: "error" });
  assert.deepEqual(log.errors, ["CONNECTION_LOST"]);
  assert.equal(log.statuses.at(-1), "ended");
});
