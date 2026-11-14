import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOUNDS, OUTCOMES, sanitizeScript } from "../shared/contract.js";
import { listScenarios } from "../scenarios/index.js";
import { AUTOFAIL_TYPES } from "../rules/autofails.js";
import { STRIKE_TYPES } from "../rules/strikes.js";
import { TACTICS } from "../judge/schema.js";
import { scriptFor } from "./index.js";
import * as phrases from "./phrases.js";

const tactics = TACTICS.filter((t) => t !== "none");
const ALL_TYPES = [...STRIKE_TYPES, ...AUTOFAIL_TYPES, ...tactics];
const SCENARIO_IDS = [...listScenarios().map((s) => s.id), "some_new_scenario"];
const words = (s) => s.trim().split(/\s+/).length;
const event = (tier, type) => ({ tier, type, quote: "x", source: "rules", confidence: 1, t: 0 });
const fixture = (f) => JSON.parse(readFileSync(new URL(`../../test/fixtures/${f}`, import.meta.url), "utf8"));
const SHAMING = /\b(stupid|dumb|foolish|idiot|gullible|should have known|your fault|silly|naive)\b/i;

function checkSay(say, maxWords, label) {
  assert.equal(typeof say, "string", label);
  assert.ok(!/\d/.test(say), `${label}: digits in "${say}"`);
  assert.ok(words(say) < maxWords, `${label}: ${words(say)} words: "${say}"`);
  assert.ok(!SHAMING.test(say), `${label}: shaming`);
  assert.ok(!/undefined|null|\{|\}|\.\./.test(say), `${label}: "${say}"`);
  assert.deepEqual(sanitizeScript({ say, sound: null }).say, say, `${label}: the core would change this line`);
}

test("ref: every rule type and judge tactic has its own strike phrase and trick payoff", () => {
  for (const type of ALL_TYPES) {
    assert.ok(phrases.STRIKE_PHRASES[type]?.what && phrases.STRIKE_PHRASES[type]?.why, `strike phrase: ${type}`);
    assert.ok(phrases.TRICK_PAYOFFS[type], `trick payoff: ${type}`);
  }
  for (const tactic of tactics) assert.ok(phrases.GOOD_DEFENSES[tactic], `good defense: ${tactic}`);
  for (const { id } of listScenarios()) assert.ok(phrases.TRICK_SETUPS[id], `trick setup: ${id}`);
});

test("ref: strike lines whistle, name the strike in words, and stay under 30 words", () => {
  for (const type of [...ALL_TYPES, "some_new_type", undefined]) {
    for (const strikeNumber of [1, 2, 3]) {
      const { say, sound } = scriptFor({ type: "strike_called", strikeNumber, event: event("strike", type) });
      assert.equal(sound, "whistle");
      checkSay(say, 30, `strike ${type} ${strikeNumber}`);
      assert.ok(say.startsWith(`Strike ${["one", "two", "three"][strikeNumber - 1]}. `), say);
    }
  }
  assert.equal(
    scriptFor({ type: "strike_called", strikeNumber: 1, event: event("strike", "confirmed_bank") }).say,
    "Strike one. You told them your bank. Scammers use that to sound legit.",
  );
});

test("ref: unknown types and odd input get a generic line, never a crash", () => {
  const generic = scriptFor({ type: "strike_called", strikeNumber: 2, event: event("strike", "some_new_type") }).say;
  assert.equal(generic, "Strike two. You went along with the caller. Scammers count on you being polite.");
  assert.equal(scriptFor({ type: "strike_called", strikeNumber: 2, event: event("strike", "constructor") }).say, generic);
  assert.equal(scriptFor({ type: "strike_called" }).say, "Strike. You went along with the caller. Scammers count on you being polite.");
  for (const bad of [undefined, null, {}, { type: "nope" }, "reveal", 7]) {
    assert.deepEqual(scriptFor(bad), { say: null, sound: null });
  }
});

test("ref: warnings are silent and credit is a chime", () => {
  assert.deepEqual(scriptFor({ type: "warning_shown", event: event("warning", "fear") }), { say: null, sound: null });
  assert.deepEqual(scriptFor({ type: "credit_shown", event: event("good_defense", "verification") }), { say: null, sound: "chime" });
});

test("ref: reveal sounds follow the outcome and are always from the allowed set", () => {
  const sound = (outcome) => scriptFor({ type: "reveal", outcome, events: [], scenarioId: "cra" }).sound;
  assert.equal(sound("failed_autofail"), "red_card");
  assert.equal(sound("failed_strikes"), "chime");
  assert.equal(sound("passed"), "fanfare");
  for (const outcome of [...OUTCOMES, "weird", undefined]) assert.ok(SOUNDS.includes(sound(outcome)), String(outcome));
});

test("ref: every failed unmask (scenario x type) is first person, kind, digit-free, under 50 words", () => {
  for (const scenarioId of SCENARIO_IDS) {
    for (const type of [...ALL_TYPES, "some_new_type"]) {
      for (const [outcome, tier] of [["failed_autofail", "autofail"], ["failed_strikes", "strike"]]) {
        const { say } = scriptFor({ type: "reveal", outcome, scenarioId, events: [event(tier, type)] });
        checkSay(say, 50, `${scenarioId}/${type}/${outcome}`);
        assert.ok(say.startsWith("Okay, I'll drop the act. This was a Loki drill, and you're safe. Nothing you said was saved. I "), say);
        assert.ok(say.endsWith("Next time, hang up and call the official number yourself."), say);
      }
    }
    checkSay(scriptFor({ type: "reveal", outcome: "failed_strikes", scenarioId, events: [] }).say, 50, `${scenarioId}/no events`);
    checkSay(scriptFor({ type: "reveal", outcome: "failed_strikes", scenarioId }).say, 50, `${scenarioId}/missing events`);
  }
});

test("ref: every scenario has its own trick line", () => {
  const lines = listScenarios().map(({ id }) =>
    scriptFor({ type: "reveal", outcome: "failed_autofail", scenarioId: id, events: [event("autofail", "card_number")] }).say);
  assert.equal(new Set(lines).size, 3);
  const generic = scriptFor({ type: "reveal", outcome: "failed_autofail", scenarioId: "some_new_scenario", events: [event("autofail", "card_number")] }).say;
  assert.ok(!lines.includes(generic));
  assert.ok(generic.includes(phrases.GENERIC_SETUP));
});

test("ref: the failed unmask talks about the event that ended the drill", () => {
  const events = [event("strike", "confirmed_bank"), event("warning", "fear"), event("autofail", "card_number")];
  const autofail = scriptFor({ type: "reveal", outcome: "failed_autofail", scenarioId: "cra", events }).say;
  assert.ok(autofail.includes("I said a warrant was coming today so you'd panic, and that got you to read me a card number."), autofail);
  const strikes = scriptFor({
    type: "reveal", outcome: "failed_strikes", scenarioId: "cra",
    events: [event("strike", "confirmed_bank"), event("strike", "secrecy"), event("strike", "stayed_on_line"), event("warning", "fear")],
  }).say;
  assert.ok(strikes.includes("that kept you on the line with me"), strikes);
});

test("ref: every passed unmask is first person, kind, digit-free, under 50 words", () => {
  const types = [...tactics, "asked_to_verify", "will_call_back", "general", "some_new_type"];
  for (const scenarioId of SCENARIO_IDS) {
    for (const type of types) {
      const { say } = scriptFor({ type: "reveal", outcome: "passed", scenarioId, events: [event("good_defense", type)] });
      checkSay(say, 50, `${scenarioId}/passed/${type}`);
      assert.ok(say.startsWith("Okay, I'll drop the act. This was a Loki drill, and you beat me. You "), say);
      assert.ok(say.endsWith("Hanging up and calling the official number is exactly right."), say);
    }
    checkSay(scriptFor({ type: "reveal", outcome: "passed", scenarioId, events: [] }).say, 50, `${scenarioId}/passed/none`);
  }
  const praised = scriptFor({
    type: "reveal", outcome: "passed", scenarioId: "cra",
    events: [event("strike", "confirmed_bank"), event("good_defense", "verification")],
  }).say;
  assert.ok(praised.includes("You asked me to prove who I was, and I couldn't."));
  const early = scriptFor({ type: "reveal", outcome: "passed", scenarioId: "cra", events: [event("strike", "confirmed_bank")] }).say;
  assert.ok(early.includes(phrases.ENDED_EARLY));
});

test("ref: works on the shared reveal fixtures", () => {
  for (const f of ["reveal-passed.json", "reveal-failed-strikes.json", "reveal-failed-autofail.json"]) {
    const reveal = fixture(f);
    const { say, sound } = scriptFor(reveal);
    assert.equal(sound, reveal.ref.sound, f);
    checkSay(say, 50, f);
  }
});
