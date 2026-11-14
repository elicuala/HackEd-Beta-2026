// Owned by Agent L. The AI half of the ref: a second opinion on each victim line.
// judgeTurn({ recentTurns, scenario }) -> Promise<RefEvent[]>   (never throws, never returns an autofail)
import OpenAI from "openai";
import { makeEvent } from "../shared/contract.js";
import { VERDICTS, TACTICS, VERDICT_FORMAT } from "./schema.js";
import { SYSTEM_PROMPT, buildInput, scrub } from "./prompt.js";
import { mockJudge } from "./mock.js";

export const JUDGE_TIMEOUT_MS = 4000;
export const MIN_WORDS_TO_JUDGE = 3;

let client = null;
function getClient() {
  // No retries: a late call is worse than no call. The key comes from OPENAI_API_KEY.
  client ??= new OpenAI({ timeout: JUDGE_TIMEOUT_MS, maxRetries: 0 });
  return client;
}

/** True when we should use the keyword mock instead of the network. */
export function usesMock(env = process.env) {
  return env.JUDGE_MOCK === "1" || !env.OPENAI_API_KEY || !env.JUDGE_MODEL;
}

// Thinking time is the judge's biggest latency cost, and this call doesn't need it.
// Not every model accepts the option, so we stop sending it the first time one says no.
let reasoningOff = true;

/** Ask the model for a verdict. May throw (timeout, network, bad JSON). The caller catches. */
export async function askModel(input, { api = getClient(), model = process.env.JUDGE_MODEL } = {}) {
  const body = {
    model,
    instructions: SYSTEM_PROMPT,
    input: buildInput(input),
    text: { format: VERDICT_FORMAT },
  };
  const options = { timeout: JUDGE_TIMEOUT_MS, maxRetries: 0 };
  let response;
  try {
    response = await api.responses.create(reasoningOff ? { ...body, reasoning: { effort: "none" } } : body, options);
  } catch (err) {
    const rejectedOption = reasoningOff && err?.status === 400 && /reasoning/i.test(String(err?.message));
    if (!rejectedOption) throw err;
    reasoningOff = false;
    response = await api.responses.create(body, options);
  }
  return JSON.parse(response.output_text);
}

/**
 * Turn the judge's answer into events. Anything suspicious is dropped.
 * @param result  { verdict, tactic, quote, reason, confidence } from the model or the mock
 * @param lines   versions of the latest victim line the quote is allowed to come from
 */
export function toEvents(result, lines, t = 0) {
  if (!result || typeof result !== "object") return [];
  const { verdict, tactic, quote, confidence } = result;
  if (!VERDICTS.includes(verdict) || verdict === "none") return [];
  if (typeof quote !== "string" || !quote.trim()) return [];

  // The quote must be the person's own words, or the model made it up.
  const needle = quote.trim().toLowerCase();
  if (!lines.some((line) => String(line ?? "").toLowerCase().includes(needle))) return [];

  const sure = Number(confidence);
  return [
    makeEvent({
      tier: verdict, // "warning" | "strike" | "good_defense": never "autofail"
      type: TACTICS.includes(tactic) && tactic !== "none" ? tactic : "general",
      quote: quote.trim(),
      source: "ai",
      confidence: Number.isFinite(sure) ? Math.min(1, Math.max(0, sure)) : 0,
      t,
    }),
  ];
}

export async function judgeTurn({ recentTurns, scenario } = {}, deps = {}) {
  try {
    const latest = Array.isArray(recentTurns) ? recentTurns.at(-1) : null;
    if (latest?.speaker !== "victim" || typeof latest.text !== "string" || !latest.text.trim()) return [];

    // "Okay.", "Yes.", "Hmm": too little to judge on its own. The rules engine reads these against what the
    // scammer just asked; judging them too only repeated its calls (and cost a model call per grunt).
    if (latest.text.trim().split(/\s+/).length < MIN_WORDS_TO_JUDGE) return [];

    const t = typeof latest.t === "number" ? latest.t : 0;
    const mock = deps.mock ?? usesMock();
    const result = mock ? mockJudge(latest.text) : await askModel({ recentTurns, scenario }, deps);
    return toEvents(result, [latest.text, scrub(latest.text)], t);
  } catch {
    return [];
  }
}
