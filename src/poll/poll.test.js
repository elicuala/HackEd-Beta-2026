// The polling fallback for the live call stream (used when a tunnel holds Server-Sent Events back).
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import register, { _resetPollForTests, MAX_EVENTS_PER_CALL } from "./routes.js";
import { createCall, processTurn, endCall, _resetForTests } from "../core/calls.js";
import { publish } from "../core/bus.js";

describe("poll fallback", () => {
  let server;
  let base;
  before(async () => {
    const app = express();
    register(app);
    await new Promise((r) => (server = app.listen(0, "127.0.0.1", r)));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());
  beforeEach(() => {
    _resetForTests();
    _resetPollForTests();
  });
  const poll = async (callId, after = 0) => (await fetch(`${base}/api/stream/poll?callId=${callId}&after=${after}`)).json();

  test("a new call's first event is its status, and a late dashboard still sees the whole call", async () => {
    const { callId } = createCall({ scenarioId: "cra", channel: "phone" });
    await processTurn(callId, { speaker: "scammer", text: "Which bank do you use?", t: 1 });
    await processTurn(callId, { speaker: "victim", text: "I'm with TD.", t: 2 });
    const first = await poll(callId);
    assert.equal(first.status, "live");
    assert.deepEqual(first.events.map((e) => e.kind), ["status", "turn", "turn", "action"]);
    assert.deepEqual(first.events.map((e) => e.n), [1, 2, 3, 4]);
    assert.equal(first.next, 4);
    assert.equal(first.events[3].data.type, "strike_called"); // the bank strike
    assert.equal(first.events[3].data.strikeNumber, 1);
  });

  test("after= returns only what is new, in order, and nothing twice", async () => {
    const { callId } = createCall({ scenarioId: "cra", channel: "phone" });
    let page = await poll(callId);
    let cursor = page.events.at(-1).n;
    assert.deepEqual((await poll(callId, cursor)).events, []);
    await processTurn(callId, { speaker: "victim", text: "Hello?", t: 1 });
    page = await poll(callId, cursor);
    assert.deepEqual(page.events.map((e) => e.kind), ["turn"]);
    cursor = page.events.at(-1).n;
    await endCall(callId);
    page = await poll(callId, cursor);
    assert.deepEqual(page.events.map((e) => e.kind + ":" + (e.data.type ?? e.data.status)), ["action:reveal", "status:reveal"]);
    assert.equal(page.status, "reveal");
    assert.deepEqual((await poll(callId, page.next)).events, []);
  });

  test("it carries exactly what the stream carries: redacted text, never digits", async () => {
    const { callId } = createCall({ scenarioId: "cra", channel: "phone" });
    await processTurn(callId, { speaker: "victim", text: "my card is 4512 3344", t: 3 });
    const page = await poll(callId);
    const turn = page.events.find((e) => e.kind === "turn").data;
    assert.equal(turn.text, "my card is •••• ••••");
    const reveal = page.events.find((e) => e.kind === "action").data;
    assert.equal(reveal.outcome, "failed_autofail");
    for (const ev of reveal.events) assert.ok(!/\d/.test(ev.quote), ev.quote); // the red card's quote
    assert.ok(!/\d/.test(reveal.ref.say ?? ""));
  });

  test("unknown or missing call → 404 in the standard error shape", async () => {
    for (const q of ["callId=nope", ""]) {
      const res = await fetch(`${base}/api/stream/poll?${q}`);
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error.code, "CALL_NOT_FOUND");
    }
  });

  test("a bad after= is treated as 0, and responses are never cached", async () => {
    const { callId } = createCall({ scenarioId: "cra", channel: "phone" });
    for (const after of ["abc", "-5", "", "1e9x"]) {
      const res = await fetch(`${base}/api/stream/poll?callId=${callId}&after=${after}`);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const body = await res.json();
      assert.ok(body.events.length >= 1 || after === "1e9x", `after=${after}`);
    }
  });

  test("each call keeps a bounded log, and calls don't see each other's events", async () => {
    const a = createCall({ scenarioId: "cra", channel: "phone" }).callId;
    const b = createCall({ scenarioId: "cra", channel: "phone" }).callId;
    for (let i = 0; i < MAX_EVENTS_PER_CALL + 50; i++) publish(a, "turn", { speaker: "scammer", text: "x", t: i });
    const page = await poll(a);
    assert.equal(page.events.length, MAX_EVENTS_PER_CALL);
    assert.equal(page.next, MAX_EVENTS_PER_CALL + 51); // numbering keeps counting
    assert.equal(page.events.at(-1).n, page.next);
    const other = await poll(b);
    assert.deepEqual(other.events.map((e) => e.kind), ["status"]);
  });
});
