// FOUNDATION tests. Must stay green on every branch.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  redact, makeEvent, validateEvent, validateTurn, sanitizeScript, SOUNDS,
} from "../src/shared/contract.js";
import { createCallState, handleEvent, endCall } from "../src/core/callState.js";
import { onTurn } from "../src/core/pipeline.js";
import * as calls from "../src/core/calls.js";
import { subscribe } from "../src/core/bus.js";
import { ownerOf } from "../scripts/check-ownership.js";

const rule = (tier, type, quote = "x") => makeEvent({ tier, type, quote, source: "rules" });
const ai = (tier, type, confidence) => makeEvent({ tier, type, quote: "x", source: "ai", confidence });
const fresh = () => createCallState({ callId: "c1", scenarioId: "cra" });
const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));

beforeEach(() => calls._resetForTests());

test("contract: redact and validation", () => {
  assert.equal(redact("card 4512 9"), "card •••• •");
  assert.equal(makeEvent({ tier: "strike", type: "t", quote: "12", source: "rules" }).quote, "••");
  assert.deepEqual(validateEvent(ai("autofail", "x", 1)).errors, ["ai cannot autofail"]);
  assert.ok(!validateEvent({ ...rule("strike", "t"), quote: "1" }).ok);
  assert.ok(validateTurn({ speaker: "victim", text: "hi", t: 1 }).ok);
  assert.ok(!validateTurn({ speaker: "ref", text: "hi", t: 1 }).ok);
});

test("core: three strikes reveals failed_strikes", () => {
  let s = fresh();
  const all = [];
  for (const type of ["a", "b", "c"]) {
    const r = handleEvent(s, rule("strike", type));
    s = r.state;
    all.push(...r.actions);
  }
  assert.equal(s.status, "reveal");
  assert.equal(s.outcome, "failed_strikes");
  assert.deepEqual(all.map((a) => a.type), ["strike_called", "strike_called", "strike_called", "reveal"]);
});

test("core: autofail reveals immediately and later events are ignored", () => {
  let { state } = handleEvent(fresh(), rule("autofail", "card_number"));
  assert.equal(state.outcome, "failed_autofail");
  const r = handleEvent(state, rule("strike", "a"));
  assert.deepEqual(r.actions, []);
});

test("core: low-confidence AI strike and repeat strike type become warnings", () => {
  let r = handleEvent(fresh(), ai("strike", "urgency", 0.5));
  assert.equal(r.actions[0].type, "warning_shown");
  r = handleEvent(r.state, rule("strike", "secrecy"));
  r = handleEvent(r.state, rule("strike", "secrecy"));
  assert.equal(r.actions[0].type, "warning_shown");
  assert.equal(r.state.strikes, 1);
});

test("core: downgraded warnings say why (for the Ref's view)", () => {
  let r = handleEvent(fresh(), ai("strike", "urgency", 0.5));
  assert.equal(r.actions[0].event.downgraded, "low_confidence");
  r = handleEvent(r.state, rule("strike", "secrecy"));
  assert.equal("downgraded" in r.actions[0].event, false);
  r = handleEvent(r.state, ai("strike", "secrecy", 0.95));
  assert.equal(r.actions[0].event.downgraded, "repeat_type");
  r = handleEvent(r.state, ai("warning", "fear", 0.9));
  assert.equal("downgraded" in r.actions[0].event, false);
  assert.ok(!validateEvent({ ...rule("warning", "x"), downgraded: "nope" }).ok);
});

test("contract: sanitizeScript keeps known sounds and strips digits", () => {
  for (const sound of SOUNDS) assert.equal(sanitizeScript({ say: "hi", sound }).sound, sound);
  assert.deepEqual(sanitizeScript({ say: "Strike 2.", sound: "buzzer" }), { say: "Strike •.", sound: null });
  assert.deepEqual(sanitizeScript(undefined), { say: null, sound: null });
  assert.deepEqual(sanitizeScript({ say: "  ", sound: "chime" }), { say: null, sound: "chime" });
});

test("calls: reveal sound follows the outcome (stub ref)", async () => {
  const { callId } = calls.createCall({ scenarioId: "cra" });
  const [reveal] = await calls.endCall(callId);
  assert.equal(reveal.outcome, "passed");
  assert.equal(reveal.ref.sound, "fanfare");
});

test("core: AI autofail is rejected", () => {
  const bad = { ...ai("strike", "x", 1), tier: "autofail" };
  const r = handleEvent(fresh(), bad);
  assert.deepEqual(r.actions, []);
  assert.equal(r.state.status, "live");
});

test("core: endCall while live passes; good_defense gives credit", () => {
  let r = handleEvent(fresh(), rule("good_defense", "will_call_back"));
  assert.equal(r.actions[0].type, "credit_shown");
  r = endCall(r.state);
  assert.equal(r.actions[0].outcome, "passed");
});

test("pipeline: stop phrase ends with passed; history is redacted; rules get raw text", async () => {
  let seen = "";
  const ctx = {
    checkRules: ({ victimLine }) => ((seen = victimLine), []),
    judgeTurn: async () => [],
    scenario: { red_flag_phrases: ["warrant"] },
  };
  let r = await onTurn(fresh(), { speaker: "victim", text: "my pin is 1234", t: 1 }, ctx);
  assert.equal(seen, "my pin is 1234");
  assert.equal(r.state.history[0].text, "my pin is ••••");
  r = await onTurn(r.state, { speaker: "victim", text: "Stop.", t: 2 }, ctx);
  assert.equal(r.state.outcome, "passed");
});

test("pipeline: red flag timer and judge errors are swallowed", async () => {
  let secs = null;
  const ctx = {
    checkRules: ({ secondsSinceRedFlag }) => ((secs = secondsSinceRedFlag), []),
    judgeTurn: async () => {
      throw new Error("boom");
    },
    scenario: { red_flag_phrases: ["warrant"] },
  };
  let r = await onTurn(fresh(), { speaker: "scammer", text: "A WARRANT is out", t: 10 }, ctx);
  r = await onTurn(r.state, { speaker: "victim", text: "hmm", t: 55 }, ctx);
  assert.equal(secs, 45);
  assert.equal(r.state.status, "live");
});

test("calls: end-to-end with stubs, publishes to the bus, attaches ref", async () => {
  const { callId } = calls.createCall({ scenarioId: "cra" });
  const kinds = [];
  const off = subscribe(callId, (m) => kinds.push(m.kind));
  for (const t of fixture("transcript-cra-pass.json")) await calls.processTurn(callId, t);
  off();
  const state = calls.getCall(callId);
  assert.equal(state.outcome, "passed");
  assert.ok(kinds.includes("turn") && kinds.includes("action"));
  assert.deepEqual(await calls.endCall(callId), []);
});

test("calls: reveal wire action has the RevealResult fields", async () => {
  const { callId } = calls.createCall({ scenarioId: "cra" });
  const [reveal] = await calls.endCall(callId);
  for (const k of ["type", "callId", "outcome", "events", "scenarioId", "scenarioTitle", "endedAt", "ref"]) {
    assert.ok(k in reveal, `missing ${k}`);
  }
});

test("calls: unknown call and unknown scenario throw coded errors", async () => {
  await assert.rejects(calls.processTurn("nope", { speaker: "victim", text: "x", t: 0 }), {
    code: "CALL_NOT_FOUND",
  });
  assert.throws(() => calls.createCall({ scenarioId: "nope" }), { code: "SCENARIO_NOT_FOUND" });
});

test("fixtures: reveal fixtures match the contract", () => {
  for (const f of ["reveal-passed.json", "reveal-failed-strikes.json", "reveal-failed-autofail.json"]) {
    const r = fixture(f);
    assert.equal(r.type, "reveal");
    assert.ok(SOUNDS.includes(r.ref.sound), `${f}: bad ref.sound`);
    for (const e of r.events) assert.ok(validateEvent(e).ok, `${f}: ${validateEvent(e).errors}`);
  }
});

test("ownership: longest prefix wins", () => {
  assert.equal(ownerOf("public/js/drill.js"), "frontend");
  assert.equal(ownerOf("public/js/voice-client.js"), "backend");
  assert.equal(ownerOf("src/rules/index.js"), "logic");
  assert.equal(ownerOf("src/core/calls.js"), "foundation");
  assert.equal(ownerOf("server.js"), "foundation");
  assert.equal(ownerOf("random.txt"), null);
});
