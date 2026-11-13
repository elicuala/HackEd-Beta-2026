import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateEvent } from "../shared/contract.js";
import { getScenario, listScenarios } from "../scenarios/index.js";
import { judgeTurn, toEvents, usesMock, askModel, JUDGE_TIMEOUT_MS } from "./index.js";
import { mockJudge } from "./mock.js";
import { VERDICTS, TACTICS, VERDICT_FORMAT } from "./schema.js";
import { SYSTEM_PROMPT, buildInput } from "./prompt.js";

const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
const victim = (text, t = 5) => ({ speaker: "victim", text, t });
const scammer = (text, t = 0) => ({ speaker: "scammer", text, t });
const scenario = getScenario("cra");

/** A fake OpenAI client that records the request and answers with `answer`. */
function fakeApi(answer) {
  const calls = [];
  return {
    calls,
    responses: {
      create: async (body, options) => {
        calls.push({ body, options });
        if (answer instanceof Error) throw answer;
        return { output_text: typeof answer === "string" ? answer : JSON.stringify(answer) };
      },
    },
  };
}
const real = (api) => ({ mock: false, api, model: "test-model" });

test("judge: npm test runs on the mock", () => {
  assert.equal(process.env.JUDGE_MOCK, "1");
  assert.equal(usesMock(), true);
  assert.equal(usesMock({ JUDGE_MOCK: "0", OPENAI_API_KEY: "", JUDGE_MODEL: "m" }), true);
  assert.equal(usesMock({ JUDGE_MOCK: "0", OPENAI_API_KEY: "k", JUDGE_MODEL: "" }), true);
  assert.equal(usesMock({ JUDGE_MOCK: "0", OPENAI_API_KEY: "k", JUDGE_MODEL: "m" }), false);
});

test("judge: returns [] unless the last turn is the victim's", async () => {
  assert.deepEqual(await judgeTurn({ recentTurns: [], scenario }), []);
  assert.deepEqual(await judgeTurn({ recentTurns: [victim("This is a scam"), scammer("No it isn't")], scenario }), []);
  assert.deepEqual(await judgeTurn({ recentTurns: [victim("   ")], scenario }), []);
});

test("judge: never throws on bad input", async () => {
  assert.deepEqual(await judgeTurn(), []);
  assert.deepEqual(await judgeTurn({}), []);
  assert.deepEqual(await judgeTurn({ recentTurns: "nope" }), []);
  assert.deepEqual(await judgeTurn({ recentTurns: [null] }), []);
  assert.deepEqual(await judgeTurn({ recentTurns: [victim(42)] }), []);
});

test("judge (mock): skepticism earns a good_defense", async () => {
  const [e] = await judgeTurn({
    recentTurns: [scammer("A warrant will be issued."), victim("I'm going to hang up and call the official number.", 15)],
    scenario,
  });
  assert.equal(e.tier, "good_defense");
  assert.equal(e.type, "verification");
  assert.equal(e.source, "ai");
  assert.equal(e.t, 15);
  assert.ok(validateEvent(e).ok);
});

test("judge (mock): agrees with all 15 cases in cases.json", () => {
  assert.equal(cases.length, 15);
  for (const group of ["hooked", "skeptical", "neutral"]) {
    assert.equal(cases.filter((c) => c.group === group).length, 5, group);
  }
  const ids = listScenarios().map((s) => s.id);
  for (const c of cases) {
    assert.ok(VERDICTS.includes(c.expected), c.id);
    assert.ok(ids.includes(c.scenario), c.id);
    assert.ok(!/\d/.test(c.victim + c.scammer), `${c.id}: no digits in eval cases`);
    assert.equal(mockJudge(c.victim).verdict, c.expected, c.id);
  }
});

test("judge (mock): every answer is a valid, non-autofail event with a known tactic", async () => {
  for (const c of cases) {
    const events = await judgeTurn({ recentTurns: [scammer(c.scammer), victim(c.victim)], scenario });
    assert.ok(events.length <= 1);
    for (const e of events) {
      assert.ok(validateEvent(e).ok, `${c.id}: ${validateEvent(e).errors}`);
      assert.notEqual(e.tier, "autofail");
      assert.ok(TACTICS.includes(e.type) && e.type !== "none", `${c.id}: ${e.type}`);
    }
  }
});

test("judge (mock): the cra-fail fixture lines never earn a confident strike", async () => {
  const turns = JSON.parse(readFileSync(new URL("../../test/fixtures/transcript-cra-fail.json", import.meta.url), "utf8"));
  for (const turn of turns.filter((x) => x.speaker === "victim")) {
    for (const e of await judgeTurn({ recentTurns: [turn], scenario })) assert.notEqual(e.tier, "strike", turn.text);
  }
});

test("toEvents: none, unknown verdicts, and autofail are dropped", () => {
  const line = "Okay, I'll pay today.";
  const base = { tactic: "payment", quote: "I'll pay today", reason: "r", confidence: 0.9 };
  assert.deepEqual(toEvents({ ...base, verdict: "none" }, [line]), []);
  assert.deepEqual(toEvents({ ...base, verdict: "autofail" }, [line]), []);
  assert.deepEqual(toEvents({ ...base, verdict: "banana" }, [line]), []);
  assert.deepEqual(toEvents(null, [line]), []);
  assert.deepEqual(toEvents("strike", [line]), []);
});

test("toEvents: the quote must be the person's own words (any letter case)", () => {
  const line = "Okay, I'll pay today.";
  const base = { verdict: "strike", tactic: "payment", reason: "r", confidence: 0.9 };
  assert.equal(toEvents({ ...base, quote: "i'll PAY today" }, [line]).length, 1);
  assert.deepEqual(toEvents({ ...base, quote: "I will pay you everything" }, [line]), []);
  assert.deepEqual(toEvents({ ...base, quote: "" }, [line]), []);
  assert.deepEqual(toEvents({ ...base, quote: 7 }, [line]), []);
});

test("toEvents: builds a clean event (clamped confidence, redacted quote, fallback type)", () => {
  const line = "my code is ••••, okay?";
  const [e] = toEvents({ verdict: "warning", tactic: "none", quote: "my code is ••••", reason: "r", confidence: 7 }, [line], 12);
  assert.deepEqual(e, { tier: "warning", type: "general", quote: "my code is ••••", source: "ai", confidence: 1, t: 12 });
  assert.equal(toEvents({ verdict: "warning", tactic: "fear", quote: "okay", confidence: "x" }, [line])[0].confidence, 0);
  assert.equal(toEvents({ verdict: "warning", tactic: "fear", quote: "okay", confidence: -3 }, [line])[0].confidence, 0);
});

test("judge (API path, faked): sends a strict schema, the model, a timeout, and no retries", async () => {
  const api = fakeApi({ verdict: "good_defense", tactic: "verification", quote: "prove it", reason: "r", confidence: 0.92 });
  const turns = [scammer("This is Officer Grant."), victim("Then prove it.", 9)];
  const events = await judgeTurn({ recentTurns: turns, scenario }, real(api));
  assert.deepEqual(events, [
    { tier: "good_defense", type: "verification", quote: "prove it", source: "ai", confidence: 0.92, t: 9 },
  ]);
  const [{ body, options }] = api.calls;
  assert.equal(body.model, "test-model");
  assert.equal(body.instructions, SYSTEM_PROMPT);
  assert.equal(body.text.format, VERDICT_FORMAT);
  assert.deepEqual(body.reasoning, { effort: "none" });
  assert.deepEqual(options, { timeout: JUDGE_TIMEOUT_MS, maxRetries: 0 });
  assert.equal(JUDGE_TIMEOUT_MS, 4000);
});

test("judge (API path, faked): errors, timeouts, bad JSON, and made-up quotes all give []", async () => {
  const turns = [scammer("Pay now."), victim("Hmm, let me think.")];
  assert.deepEqual(await judgeTurn({ recentTurns: turns, scenario }, real(fakeApi(new Error("timeout")))), []);
  assert.deepEqual(await judgeTurn({ recentTurns: turns, scenario }, real(fakeApi("not json"))), []);
  assert.deepEqual(await judgeTurn({ recentTurns: turns, scenario }, real(fakeApi("null"))), []);
  const invented = { verdict: "strike", tactic: "payment", quote: "I will pay", reason: "r", confidence: 0.99 };
  assert.deepEqual(await judgeTurn({ recentTurns: turns, scenario }, real(fakeApi(invented))), []);
  const autofail = { verdict: "autofail", tactic: "payment", quote: "let me think", reason: "r", confidence: 0.99 };
  assert.deepEqual(await judgeTurn({ recentTurns: turns, scenario }, real(fakeApi(autofail))), []);
  await assert.rejects(askModel({ recentTurns: turns, scenario }, real(fakeApi("not json"))));
});

test("schema: strict structured output with the agreed fields", () => {
  const { schema } = VERDICT_FORMAT;
  assert.equal(VERDICT_FORMAT.type, "json_schema");
  assert.equal(VERDICT_FORMAT.strict, true);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["verdict", "tactic", "quote", "reason", "confidence"]);
  assert.deepEqual(Object.keys(schema.properties), schema.required);
  assert.deepEqual(schema.properties.verdict.enum, ["none", "warning", "strike", "good_defense"]);
  assert.deepEqual(schema.properties.tactic.enum,
    ["urgency", "authority", "secrecy", "fear", "sympathy", "payment", "verification", "none"]);
});

test("prompt: no digits, spoken or written, reach the judge", () => {
  const input = buildInput({
    recentTurns: [scammer("Read me the code."), victim("It's four five one two and my pin is 9911")],
    scenario,
  });
  assert.ok(!/\d/.test(input), input);
  assert.ok(!/four five one two/.test(input));
  assert.ok(input.includes(scenario.title) && input.includes(scenario.goal));
  assert.ok(input.includes('Judge this line from the person: "It\'s •••• and my pin is ••••"'));
  for (const word of ["consensual", "latest line", "good_defense", "rarely", "exact words"]) {
    assert.ok(SYSTEM_PROMPT.includes(word), word);
  }
});

test("judge: a quote taken from the scrubbed line is accepted", async () => {
  const api = fakeApi({ verdict: "warning", tactic: "verification", quote: "It's ••••", reason: "r", confidence: 0.6 });
  const events = await judgeTurn(
    { recentTurns: [scammer("Read me the code."), victim("It's four five one two")], scenario },
    real(api),
  );
  assert.equal(events[0]?.quote, "It's ••••");
});

// Keep this test last: after it, the module stops sending the reasoning option.
test("judge (API path, faked): a model that rejects the reasoning option is asked again without it", async () => {
  const calls = [];
  const api = {
    responses: {
      create: async (body) => {
        calls.push(body);
        if (body.reasoning) throw Object.assign(new Error("Unsupported parameter: 'reasoning.effort'"), { status: 400 });
        return { output_text: JSON.stringify({ verdict: "good_defense", tactic: "verification", quote: "prove it", reason: "r", confidence: 0.9 }) };
      },
    },
  };
  const turns = [scammer("This is Officer Grant."), victim("Then prove it.")];
  assert.equal((await judgeTurn({ recentTurns: turns, scenario }, real(api))).length, 1);
  assert.equal(calls.length, 2);
  assert.equal((await judgeTurn({ recentTurns: turns, scenario }, real(api))).length, 1);
  assert.equal(calls.length, 3);
  assert.equal("reasoning" in calls[2], false);
});
