// Regression tests for the bugs found by the end-to-end call sweep (real model, scripted callers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { unmaskInstructions, saidGoodbye } from "../../public/js/unmask-prompt.js";
import { DRILL_FRAME, scammerInstructions } from "./config.js";
import { listScenarios, getScenario } from "../scenarios/index.js";
import { checkRules } from "../rules/index.js";
import { judgeTurn, MIN_WORDS_TO_JUDGE } from "../judge/index.js";

const rules = (victimLine, lastScammerLine = "") =>
  checkRules({ victimLine, lastScammerLine, secondsSinceRedFlag: 0, alreadyStruck: new Set() }).map((e) => `${e.tier}/${e.type}`);

test("unmask: the caller is given a narrator's job and the exact script, never a bare 'step out of character'", () => {
  const text = unmaskInstructions("  Okay, I'll drop the act. This was a Loki drill.  ");
  assert.match(text, /narrator of Loki/);
  assert.match(text, /word for word/);
  assert.match(text, /Do not greet them/);
  assert.ok(text.endsWith("CLOSING SCRIPT:\nOkay, I'll drop the act. This was a Loki drill."));
  assert.ok(!/step out of character/i.test(text));
});

test("goodbye: only a sign-off at the end of the scammer's line counts", () => {
  for (const line of ["Goodbye.", "Fine. That will delay this. Goodbye.", "Goodbye. This call is over.", "Okay, bye now!", "I'm ending this call."]) {
    assert.equal(saidGoodbye(line), true, line);
  }
  for (const line of ["", "Don't say goodbye yet. Which bank do you use?", "Hello, this is Officer Grant.", "Buy the gift cards.", "Say bye to your savings if you wait."]) {
    assert.equal(saidGoodbye(line), false, line);
  }
});

test("sounds: every session is told to perform sighs and sniffs, never to say the words", () => {
  assert.match(DRILL_FRAME, /Perform sounds with your voice; never name them/);
  assert.match(DRILL_FRAME, /Never say "sigh"/);
  for (const { id } of listScenarios()) {
    const prompt = scammerInstructions(getScenario(id).system_prompt);
    // A bare "sigh" / "sniff" instruction is what made the model say the word out loud.
    assert.ok(!/\band sigh before\b/.test(prompt), `${id}: bare "sigh" instruction`);
    assert.ok(!/trail off, sniff,/.test(prompt), `${id}: bare "sniff" instruction`);
  }
});

test("sounds: the two characters that sigh and sniffle are told it's a sound, not a word", () => {
  assert.match(getScenario("cra").system_prompt, /audible sigh \(an actual tired breath out, a sound and not a word\)/);
  assert.match(getScenario("grandkid").system_prompt, /sniffle \(a real sniffing sound, not a word\)/);
});

test("robot question: the caller is told to brush it off in character, not answer or ignore it", () => {
  assert.match(DRILL_FRAME, /real person, a robot, a computer or an AI/);
  assert.match(DRILL_FRAME, /do not answer that question either way/);
});

test("rules: volunteering to pay is a red card whatever the scammer just said", () => {
  const stay = "Can you stay on the phone with me while you get it ready?";
  assert.deepEqual(rules("Okay, I'll send you the e-transfer right now.", stay), ["autofail/crypto_or_wire"]);
  assert.deepEqual(rules("I'm going to wire the money this afternoon.", ""), ["autofail/crypto_or_wire"]);
  assert.deepEqual(rules("Okay, I'll go and buy the gift cards right now.", stay), ["autofail/gift_card"]);
  assert.deepEqual(rules("Let me go get some gift cards from the store.", ""), ["autofail/gift_card"]);
  // Not commitments:
  assert.deepEqual(rules("I'm not going to send you an e-transfer.", ""), []);
  assert.deepEqual(rules("I will never buy gift cards for a stranger.", ""), []);
  assert.deepEqual(rules("Should I send an e-transfer?", ""), []);
  assert.deepEqual(rules("I'll get my glasses, one moment.", ""), []);
  assert.deepEqual(rules("I'll call the tax office myself.", ""), []);
});

test("judge: bare acknowledgements are left to the rules engine", async () => {
  assert.equal(MIN_WORDS_TO_JUDGE, 3);
  const scenario = getScenario("cra");
  let asked = 0;
  const api = { responses: { create: async () => (asked++, { output_text: JSON.stringify({ verdict: "warning", tactic: "fear", quote: "Okay", reason: "r", confidence: 0.9 }) }) } };
  for (const text of ["Okay.", "Yes.", "Hmm", "Oh no.", "No, goodbye."]) {
    assert.deepEqual(await judgeTurn({ recentTurns: [{ speaker: "victim", text, t: 1 }], scenario }, { mock: false, api, model: "m" }), [], text);
  }
  assert.equal(asked, 0); // no model call at all
  const longer = await judgeTurn({ recentTurns: [{ speaker: "victim", text: "Okay, I guess so.", t: 1 }], scenario }, { mock: false, api, model: "m" });
  assert.equal(asked, 1);
  assert.equal(longer.length, 1);
});
