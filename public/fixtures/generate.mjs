// Regenerates the mock-call scripts from the REAL pipeline (rules + judge mock + ref lines).
// Usage (from the repo root): JUDGE_MOCK=1 node public/fixtures/generate.mjs
import { writeFileSync, readFileSync } from "node:fs";
import { createCall, processTurn, endCall, _resetForTests } from "../../src/core/calls.js";
import { redactSpeech } from "../../src/shared/contract.js";

process.env.JUDGE_MOCK = "1";
const here = new URL("./", import.meta.url);
const fixture = (n) => JSON.parse(readFileSync(new URL(`../../test/fixtures/${n}`, import.meta.url), "utf8"));
const lines = (pairs) => pairs.map(([speaker, text]) => ({ speaker, text }));

const SCRIPTS = {
  "mock-call-fail": { scenarioId: "cra", turns: fixture("transcript-cra-fail.json") },
  "mock-call-pass": { scenarioId: "cra", turns: fixture("transcript-cra-pass.json") },
  "mock-grandkid": {
    scenarioId: "grandkid",
    turns: lines([
      ["scammer", "Hello? It's me, your grandchild. I'm so glad you picked up. Can you hear me okay?"],
      ["victim", "Sweetheart, is that you? What's wrong?"],
      ["scammer", "I was in a car accident and now I'm in jail. Please don't tell Mom or Dad. Keep this between us."],
      ["victim", "Okay, I won't tell them."],
      ["scammer", "The lawyer says I need bail money today. Can you send it by e-transfer right now?"],
      ["victim", "Yes, I can send an e-transfer this afternoon."],
    ]),
  },
  "mock-bank_fraud": {
    scenarioId: "bank_fraud",
    turns: lines([
      ["scammer", "Hello, this is Alex from the fraud department at your bank. We've noticed some suspicious charges on your card."],
      ["victim", "Oh dear. I should sort this out right away."],
      ["scammer", "I've put a temporary hold on it. Can you confirm your full name and date of birth so I can pull up the file?"],
      ["victim", "How do I know you're really my bank? I'll hang up and call the number on the back of my card."],
      ["scammer", "Ma'am, if you hang up the hold will lapse and the charges will go through."],
      ["victim", "Then I'll take that chance. Stop."],
    ]),
  },
};

const clean = (a) => JSON.parse(JSON.stringify(a).replaceAll(a.callId, "mock-call"));

for (const [name, { scenarioId, turns }] of Object.entries(SCRIPTS)) {
  _resetForTests();
  const { callId } = createCall({ scenarioId, channel: "browser" });
  const steps = [{ delayMs: 700, kind: "status", data: "live" }];
  let t = 0;
  for (const turn of turns) {
    t += turn.speaker === "scammer" ? 2 : 4;
    const timed = { speaker: turn.speaker, text: turn.text, t };
    if (turn.speaker === "scammer") {
      steps.push({ delayMs: 900, kind: "status", data: "scammer_speaking" });
      steps.push({ delayMs: Math.min(3200, 600 + turn.text.length * 30), kind: "turn", data: { ...timed, text: redactSpeech(turn.text) } });
      steps.push({ delayMs: 250, kind: "status", data: "live" });
    } else {
      steps.push({ delayMs: 1500, kind: "turn", data: { ...timed, text: redactSpeech(turn.text) } });
    }
    const actions = (await processTurn(callId, timed)).map(clean);
    if (actions.length) steps.push({ delayMs: 500, kind: "actions", data: actions });
    if (actions.some((x) => x.type === "reveal")) break;
  }
  // What end() sends if the person presses End early (events are filled in by the mock).
  _resetForTests();
  const fresh = createCall({ scenarioId, channel: "browser" }).callId;
  const [endReveal] = (await endCall(fresh)).map(clean);
  writeFileSync(new URL(`${name}.json`, here), JSON.stringify({ scenarioId, steps, endReveal }, null, 2) + "\n");
  const outcome = steps.flatMap((s) => (s.kind === "actions" ? s.data : [])).find((a) => a.type === "reveal")?.outcome;
  console.log(`${name}: ${steps.length} steps, outcome ${outcome ?? "(none: ends on End)"}`);
}
_resetForTests();
process.exit(0);
