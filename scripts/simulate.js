// Usage: npm run simulate -- test/fixtures/transcript-cra-fail.json [scenarioId=cra]
// Runs a transcript through the real pipeline (rules, judge, scenarios, ref) and prints every action.
import { readFileSync } from "node:fs";
import { createCall, processTurn, endCall, getCall, _resetForTests } from "../src/core/calls.js";

const file = process.argv[2] || "test/fixtures/transcript-cra-fail.json";
const scenarioId = process.argv[3] || "cra";
const turns = JSON.parse(readFileSync(file, "utf8"));

const { callId } = createCall({ scenarioId, channel: "browser" });
for (const turn of turns) {
  const actions = await processTurn(callId, turn);
  const who = turn.speaker.padEnd(7);
  console.log(`${String(turn.t).padStart(5)}s ${who} ${turn.text}`);
  for (const a of actions) {
    const detail = a.event ? `${a.event.tier}/${a.event.type} "${a.event.quote}"` : a.outcome ?? "";
    console.log(`         -> ${a.type} ${detail}${a.ref?.say ? `  [ref: ${a.ref.say}]` : ""}`);
  }
  if (getCall(callId).status !== "live") break;
}
if (getCall(callId).status === "live") {
  for (const a of await endCall(callId)) console.log(`         -> ${a.type} ${a.outcome}`);
}
const final = getCall(callId);
console.log(`\nOutcome: ${final.outcome}  strikes: ${final.strikes}  events: ${final.events.length}`);
_resetForTests();
