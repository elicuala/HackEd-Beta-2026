// Agent B tests: the live board (opt-in, no callId leaks, redaction, streaming).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import register from "./routes.js";
import { shareCall, unshareCall, listBoard, watch, _resetBoardForTests } from "./board.js";
import { createCall, processTurn, endCall, _resetForTests } from "../core/calls.js";

beforeEach(() => {
  _resetBoardForTests();
  _resetForTests();
});

describe("live board", () => {
  test("only shared calls are listed, and never with their callId", async () => {
    const shared = createCall({ scenarioId: "cra", channel: "browser" }).callId;
    createCall({ scenarioId: "grandkid", channel: "browser" }); // not shared
    const watchId = shareCall(shared);
    assert.match(watchId, /^[0-9a-f-]{36}$/);
    assert.equal(shareCall(shared), watchId); // idempotent
    assert.deepEqual(listBoard(), []); // not listed until the call really starts (no ghost drills)
    assert.ok(watch(watchId, () => {}), "but its watch link already works");
    await processTurn(shared, { speaker: "scammer", text: "Hello, this is Officer Grant.", t: 1 });
    const board = listBoard();
    assert.equal(board.length, 1);
    assert.equal(board[0].title, "Tax agency call");
    assert.equal(board[0].status, "live");
    assert.ok(!JSON.stringify(board).includes(shared), "callId leaked");
  });

  test("turns and actions stream to watchers, redacted, then the reveal ends it", async () => {
    const { callId } = createCall({ scenarioId: "cra", channel: "browser" });
    const watchId = shareCall(callId);
    const got = [];
    const session = watch(watchId, (kind, data) => got.push({ kind, data }));
    assert.deepEqual(session.snapshot.items, []);

    await processTurn(callId, { speaker: "scammer", text: "Which bank do you use?", t: 2 });
    await processTurn(callId, { speaker: "victim", text: "I'm with TD.", t: 5 });
    await processTurn(callId, { speaker: "scammer", text: "Read me the card number.", t: 8 });
    await processTurn(callId, { speaker: "victim", text: "Okay it's four five one two 3344", t: 12 });

    const turns = got.filter((g) => g.kind === "item" && g.data.kind === "turn").map((g) => g.data.text);
    assert.deepEqual(turns, [
      "Which bank do you use?",
      "I'm with TD.",
      "Read me the card number.",
      "Okay it's • • • • ••••",
    ]);
    const actions = got.filter((g) => g.kind === "item" && g.data.kind === "action").map((g) => g.data);
    assert.equal(actions[0].type, "strike_called");
    assert.equal(actions[0].event.source, "rules");
    assert.ok(actions[0].say.startsWith("Strike one"));
    const reveal = actions.find((a) => a.type === "reveal");
    assert.equal(reveal.outcome, "failed_autofail");
    assert.ok(reveal.say.includes("drop the act"));
    assert.equal(got.at(-1).kind, "status");
    assert.equal(got.at(-1).data.status, "reveal");

    const text = JSON.stringify(got);
    assert.ok(!/\d{2,}/.test(text.replace(/"t":\d+(\.\d+)?|"confidence":[\d.]+|"strikeNumber":\d/g, "")), "digits leaked");
    assert.ok(!text.includes(callId), "callId leaked");

    const [row] = listBoard();
    assert.equal(row.outcome, "failed_autofail");
    assert.equal(row.strikes, 1);
    assert.ok(row.endedAt);
    session.unwatch();
  });

  test("unshare removes it and tells watchers", () => {
    const { callId } = createCall({ scenarioId: "cra", channel: "phone" });
    const watchId = shareCall(callId);
    const got = [];
    watch(watchId, (kind) => got.push(kind));
    unshareCall(callId);
    assert.deepEqual(listBoard(), []);
    assert.deepEqual(got, ["gone"]);
    assert.equal(watch(watchId, () => {}), null);
  });

  describe("HTTP", () => {
    let server;
    let base;
    after(() => server?.close());

    test("GET /api/live and the SSE stream", async () => {
      const app = express();
      register(app);
      await new Promise((r) => {
        server = app.listen(0, "127.0.0.1", r);
      });
      base = `http://127.0.0.1:${server.address().port}`;

      const { callId } = createCall({ scenarioId: "bank_fraud", channel: "browser" });
      const watchId = shareCall(callId);
      await processTurn(callId, { speaker: "scammer", text: "This is your bank's fraud team.", t: 1 });
      const list = await (await fetch(`${base}/api/live`)).json();
      assert.equal(list[0].watchId, watchId);

      let res = await fetch(`${base}/api/live/stream?watchId=nope`);
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error.code, "DRILL_NOT_FOUND");

      res = await fetch(`${base}/api/live/stream?watchId=${watchId}`);
      assert.match(res.headers.get("content-type"), /^text\/event-stream/);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const readUntil = async (needle) => {
        while (!buf.includes(needle)) buf += dec.decode((await reader.read()).value);
      };
      await readUntil("event: snapshot");
      await processTurn(callId, { speaker: "victim", text: "Stop.", t: 3 });
      await endCall(callId);
      await readUntil("event: status");
      assert.match(buf, /event: item\ndata: .*"kind":"turn"/);
      assert.match(buf, /"type":"reveal"/);
      await reader.cancel();
    });
  });
});
