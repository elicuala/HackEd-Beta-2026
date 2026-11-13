// Owned by Agent L. Run by hand, NOT part of `npm test`:  node src/judge/eval.js
// Sends the 15 cases in cases.json to the real judge model and prints agreement and latency.
// Needs OPENAI_API_KEY and JUDGE_MODEL in .env. The cases contain no personal data.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { getScenario } from "../scenarios/index.js";
import { askModel, toEvents } from "./index.js";
import { scrub } from "./prompt.js";

if (!process.env.OPENAI_API_KEY || !process.env.JUDGE_MODEL) {
  console.error("Set OPENAI_API_KEY and JUDGE_MODEL in .env to run the judge eval.");
  process.exit(1);
}

const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
let exact = 0;
let acceptable = 0;
let errors = 0;
let totalMs = 0;

for (const c of cases) {
  const recentTurns = [
    { speaker: "scammer", text: c.scammer, t: 0 },
    { speaker: "victim", text: c.victim, t: 5 },
  ];
  const start = performance.now();
  let verdict = "error";
  let note = "";
  try {
    const result = await askModel({ recentTurns, scenario: getScenario(c.scenario) });
    // Same filtering as the live judge: a made-up quote counts as "none".
    const [event] = toEvents(result, [c.victim, scrub(c.victim)], 5);
    verdict = event ? event.tier : "none";
    note = event ? `${event.type} ${Math.round(event.confidence * 100)}%` : "";
  } catch (err) {
    errors++;
    note = err?.name ?? "error";
  }
  const ms = performance.now() - start;
  totalMs += ms;

  const isExact = verdict === c.expected;
  const isOk = isExact || (c.accept ?? []).includes(verdict);
  if (isExact) exact++;
  if (isOk) acceptable++;
  const mark = isExact ? "PASS " : isOk ? "CLOSE" : "FAIL ";
  console.log(
    `${mark} ${c.id.padEnd(24)} expected ${c.expected.padEnd(12)} got ${verdict.padEnd(12)} ${note.padEnd(18)} ${Math.round(ms)} ms`,
  );
}

const avg = totalMs / cases.length;
console.log(`\nMatch (expected or an accepted neighbour): ${acceptable}/${cases.length}   target: at least 12`);
console.log(`Exact match:                               ${exact}/${cases.length}`);
console.log(`Errors or timeouts:                        ${errors}`);
console.log(`Average latency:                           ${Math.round(avg)} ms   target: under 2000 ms`);
process.exit(acceptable >= 12 && avg < 2000 ? 0 : 1);
