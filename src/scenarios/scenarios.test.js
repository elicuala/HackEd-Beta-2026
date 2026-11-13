import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENARIO_FIELDS } from "../shared/contract.js";
import { getScenario, listScenarios } from "./index.js";

// The role file says every prompt must contain these, in this order.
const REQUIRED_IN_ORDER = [
  "You are playing a scammer in a consensual scam-awareness training drill. The person agreed to this practice call.",
  "1 to 3 short sentences",
  "Never use slurs, sexual content, or threats of physical violence. Never name a real bank or real person; say 'your bank' instead. Never ask for anything beyond your goal.",
  "If the person refuses and says they will verify independently, push back once, then say goodbye and stop.",
  "If the person says 'drill' or 'stop', stop immediately and say nothing else.",
  "When you are told the drill is over, step out of character and say exactly the line you are given, kindly, and nothing else.",
];

const REAL_BANKS = /\b(rbc|royal bank|td|bmo|scotiabank|cibc|atb|tangerine|simplii|desjardins|national bank|eq bank|hsbc)\b/i;

test("scenarios: listScenarios returns the three scenarios with id, title, blurb", () => {
  const list = listScenarios();
  assert.deepEqual(list.map((s) => s.id).sort(), ["bank_fraud", "cra", "grandkid"]);
  for (const s of list) {
    assert.deepEqual(Object.keys(s).sort(), ["blurb", "id", "title"]);
    assert.ok(s.title && s.blurb);
  }
});

test("scenarios: every scenario has all contract fields with sensible values", () => {
  for (const { id } of listScenarios()) {
    const s = getScenario(id);
    for (const field of SCENARIO_FIELDS) assert.ok(field in s, `${id} missing ${field}`);
    assert.ok(Array.isArray(s.escalation) && s.escalation.length >= 3, `${id}: escalation`);
    assert.ok(s.opening_line.length > 10 && s.goal.length > 10 && s.backs_off_when.length > 10);
  }
});

test("scenarios: prompts contain the verbatim sentences, in order", () => {
  for (const { id } of listScenarios()) {
    const prompt = getScenario(id).system_prompt;
    let from = 0;
    for (const sentence of REQUIRED_IN_ORDER) {
      const at = prompt.indexOf(sentence, from);
      assert.ok(at >= 0, `${id}: missing or out of order: "${sentence}"`);
      from = at + sentence.length;
    }
    assert.ok(prompt.startsWith(REQUIRED_IN_ORDER[0]), `${id}: the role sentence must come first`);
  }
});

test("scenarios: prompts include the goal and every escalation step, in order, before the style rules", () => {
  for (const { id } of listScenarios()) {
    const s = getScenario(id);
    const styleAt = s.system_prompt.indexOf("1 to 3 short sentences");
    let from = s.system_prompt.indexOf(s.goal);
    assert.ok(from >= 0, `${id}: goal missing from prompt`);
    for (const step of s.escalation) {
      const at = s.system_prompt.indexOf(step, from);
      assert.ok(at >= 0 && at < styleAt, `${id}: step missing or out of order: "${step}"`);
      from = at + step.length;
    }
  }
});

test("scenarios: red flag phrases are 4 to 8 lowercase phrases", () => {
  for (const { id } of listScenarios()) {
    const flags = getScenario(id).red_flag_phrases;
    assert.ok(flags.length >= 4 && flags.length <= 8, `${id}: ${flags.length} phrases`);
    assert.equal(new Set(flags).size, flags.length, `${id}: duplicate phrases`);
    for (const p of flags) assert.equal(p, p.toLowerCase().trim(), `${id}: "${p}"`);
  }
});

test("scenarios: the opening line does not start the lingering timer", () => {
  for (const { id } of listScenarios()) {
    const s = getScenario(id);
    const opening = s.opening_line.toLowerCase();
    for (const p of s.red_flag_phrases) assert.ok(!opening.includes(p), `${id}: opening has "${p}"`);
  }
});

test("scenarios: no real bank is named and no digits appear anywhere", () => {
  for (const { id } of listScenarios()) {
    const s = getScenario(id);
    const spoken = [s.opening_line, s.goal, ...s.escalation, s.backs_off_when].join(" ");
    assert.ok(!REAL_BANKS.test(spoken), `${id}: names a real bank`);
    assert.ok(!/\d/.test(s.opening_line), `${id}: digits in the opening line`);
  }
});

test("scenarios: unknown id throws SCENARIO_NOT_FOUND with status 404", () => {
  assert.throws(() => getScenario("nope"), { code: "SCENARIO_NOT_FOUND", status: 404 });
});
