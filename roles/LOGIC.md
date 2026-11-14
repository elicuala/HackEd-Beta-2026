# Role L: Logic and content (Agent L)

**Person:** P3 · **Branch:** `role/logic` · **Commit prefix:** `[L]`
**Note for Eli:** `src/rules/` is the best part of the project to hand-write for JS fundamentals. Consider writing it yourself and having the agent do the judge, scenarios, and ref lines, then review your rules code.

## Mission
The brain of the ref and the script of the scammer. Everything you build is pure logic or text with tests. No servers, no UI, no audio.

**Why it matters for judging (SPEC §0):** the two-layer ref (rules plus AI judge) is our **Complexity** story, realistic Canadian scam scripts are our **Utility** story, and the unmask line is the **Originality** moment the whole demo builds to.

## You own
- `src/rules/**`
- `src/judge/**`
- `src/scenarios/**`
- `src/ref/**`
- `handoff/logic.md`

Each of these folders already contains a working **stub** that keeps the app running. Replace stubs in place, **keeping the exact exported function names and signatures** (SPEC §5.3).

## You must not touch
`src/core/`, `src/shared/`, `src/voice/`, `src/phone/`, `public/`, `server.js`, `package.json`, `test/`.
You may *import* from `src/shared/contract.js` (`makeEvent`, `redact`, `SCENARIO_FIELDS`, and so on). Always build events with `makeEvent`.

## Order of work
1. **Scenarios** (needed by Agent B early, due at sync 1)
2. **Rules engine** (due at sync 1)
3. **Ref lines** (due at sync 3)
4. **AI judge** (due at sync 3)

## 1. Scenarios: `src/scenarios/`
Files: `cra.json` (replace the stub content), `grandkid.json`, `bank_fraud.json`. Keep `index.js` and `routes.js` as they are unless you need to add validation (you own them).

| id | title | Pitch | Tactics |
|----|-------|-------|---------|
| `cra` | Tax agency call | Fake CRA officer: back taxes, a warrant, pay with gift cards | authority, fear, urgency, payment |
| `grandkid` | Grandchild in trouble | "Grandma, it's me, I'm in jail, please don't tell Mom," bail money | sympathy, secrecy, urgency |
| `bank_fraud` | Bank fraud department | "Suspicious charges, we need to verify your card and a code we text you" | authority, fake security process |

Every `system_prompt` must contain, in this order:
1. Role: "You are playing a scammer in a consensual scam-awareness training drill. The person agreed to this practice call."
2. The character, goal, and the `escalation` steps in order
3. Style: 1–3 short sentences per reply, natural speech, pushy and urgent, never long speeches
4. Guardrails (verbatim): "Never use slurs, sexual content, or threats of physical violence. Never name a real bank or real person; say 'your bank' instead. Never ask for anything beyond your goal."
5. Back-off: "If the person refuses and says they will verify independently, push back once, then say goodbye and stop."
6. Stop word (verbatim): "If the person says 'drill' or 'stop', stop immediately and say nothing else."
7. Unmask (verbatim): "When you are told the drill is over, step out of character and say exactly the line you are given, kindly, and nothing else."

`red_flag_phrases`: 4–8 lowercase phrases per scenario that the scammer will actually say (they start the lingering timer).

## 2. Rules engine: `src/rules/`
Suggested files: `normalize.js`, `agreement.js`, `autofails.js`, `strikes.js`, `index.js`, and tests.

```js
checkRules({ victimLine, lastScammerLine, secondsSinceRedFlag, alreadyStruck }) → RefEvent[]
```
`victimLine` is **raw** (it contains real digits). Every returned `quote` must be redacted (`makeEvent` does this). If an autofail fires, return **only** that event.

**Autofails**
| type | Fires when |
|---|---|
| `card_number` | 4+ consecutive digits in the victim line, after normalizing spoken numbers |
| `sin_number` | 9 digits total, or "my SIN is" / "social insurance number is" |
| `password_or_code` | `lastScammerLine` asks for a code/PIN/password/verification **and** the victim answers with digits or one short word |
| `gift_card` | `lastScammerLine` mentions gift cards **and** the victim agrees |
| `crypto_or_wire` | Same, for bitcoin / crypto / wire / e-transfer |
| `remote_access` | Same, for AnyDesk / TeamViewer / "download" / "remote" / "app" |

**Strikes** (skip a type if it's in `alreadyStruck`)
| type | Fires when |
|---|---|
| `confirmed_bank` | The victim names a bank: RBC, TD, BMO, Scotiabank, CIBC, ATB, Tangerine, Simplii, Desjardins, National Bank, EQ Bank, HSBC |
| `confirmed_identity` | A date of birth, a street address pattern, or "my name is <first last>" |
| `secrecy` | `lastScammerLine` asks for secrecy **and** the victim agrees |
| `stayed_on_line` | `lastScammerLine` says stay on the line / don't hang up **and** the victim agrees |
| `lingered` | `secondsSinceRedFlag > 45` |

Normalizer: "four five one two" → "4512", "oh" and "zero" → 0, "double five" → "55", "triple one" → "111". Agreement vs. refusal: refusals ("no", "not", "I'll call", "hang up", "scam", "won't", "don't think so") always win over agreement words.

**Required tests:** every row above fires on a positive example, plus these guards: "I don't have my card number on me" → `[]`, "my house number is 12" → `[]`, gift-card prompt + "no way, that's a scam" → `[]`, an already-struck type → `[]`, and 1000 calls finish in < 500 ms.

**Integration check:** `npm run simulate -- test/fixtures/transcript-cra-fail.json` must end with `failed_autofail`, and `transcript-cra-pass.json` with `passed`.

## 3. Ref lines: `src/ref/`
`scriptFor(action) → { say, sound }` with all text in `src/ref/phrases.js`.
**Persona:** a warm, steady sports referee (SPEC §0.2 Originality). Lines can borrow light ref language ("That's a strike," "Clean play," "Red card on that one") but stay kind and plain. The reveal is the emotional high point of the demo, so write it to land.
You also pick the **sound** (SPEC §0.4). It must be one of `"whistle" | "red_card" | "chime" | "fanfare" | null`; the core turns anything else into `null`.
- `strike_called` → sound `"whistle"`, say: `"Strike {n}. {what happened}. {why scammers want it}."` For example: "Strike one. You told them your bank. Scammers use that to sound legit." This is spoken by the browser's ref voice (or "Referee:" on the phone).
- `warning_shown` → `{ say: null, sound: null }`
- `credit_shown` → `{ say: null, sound: "chime" }`
- `reveal` → **the unmask.** This line is spoken **by the scammer's own voice dropping the act** (SPEC §1, §5.7), so write it in the first person, as the same character stepping out of the role. The action includes `outcome`, `events`, and `scenarioId`, so tailor it to them:
  - sound: `failed_autofail` → `"red_card"`, `failed_strikes` → `"chime"`, `passed` → `"fanfare"`
  - say, `failed_*`: "Okay, I'll drop the act. This was a Loki drill, and you're safe. Nothing you said was saved." + **the trick I used on you** (from the scenario and the top event type, for example "I said a warrant was coming today so you'd panic and pay fast.") + "Next time, hang up and call the official number yourself."
  - say, `passed`: "Okay, I'll drop the act. This was a Loki drill, and you beat me." + what they did right (from the `good_defense` events, or a general line) + "Hanging up and calling the official number is exactly right."

Every strike and autofail `type` from the rules engine, and every `tactic` from the judge, needs a phrase, and every scenario needs an unmask "trick" line. Unknown types and scenarios get a generic phrase. Under 30 words per strike `say` and **under 50 words for a reveal `say`**, no digits, kind, never shaming. Tests: coverage of every type and scenario, no digits, a valid sound for each action and outcome, and word limits.

## 4. AI judge: `src/judge/`
```js
judgeTurn({ recentTurns, scenario }) → Promise<RefEvent[]>   // never throws, never autofail
```
- If the last turn isn't the victim's → `[]`
- `JUDGE_MOCK=1` or no `OPENAI_API_KEY` → `mock.js`, deterministic keyword matching (tests always use this, since `npm test` sets `JUDGE_MOCK=1`)
- Otherwise call the OpenAI API (the `openai` SDK) with the model from `JUDGE_MODEL`, a **structured outputs JSON schema** `{ verdict: "none"|"warning"|"strike"|"good_defense", tactic: "urgency"|"authority"|"secrecy"|"fear"|"sympathy"|"payment"|"verification"|"none", quote: string, reason: string, confidence: number }`, a 4 s timeout, and no retries (latency matters)
- Drop the result if `quote` isn't a case-insensitive substring of the latest victim line (which is redacted, so compare against that)
- `none` → `[]`. Otherwise `makeEvent({ tier: verdict, type: tactic, quote, source: "ai", confidence, t })`
- Prompt (in `prompt.js`): referee in a consensual training drill, judge only the latest victim line, reward skepticism with `good_defense`, use `strike` rarely, prefer `warning` or `none` when unsure, the quote must be exact words

`src/judge/cases.json`: 15 victim lines with expected verdicts (5 hooked, 5 skeptical, 5 neutral). `src/judge/eval.js` (run manually, not in `npm test`): runs the cases against the real API and prints the agreement and average latency.

## Acceptance checklist (paste results into `handoff/logic.md`)
- [ ] `listScenarios()` returns 3 scenarios, and every prompt contains the verbatim guardrail, stop-word, and unmask sentences (tested)
- [ ] All rules tests pass, including the guards and the performance test
- [ ] `npm run simulate` gives `failed_autofail` on the fail fixture and `passed` on the pass fixture (paste the output)
- [ ] Every ref phrase is covered, digit-free, and within its word limit, every sound is from the allowed set, and each scenario has an unmask "trick" line (tested)
- [ ] Paste the 3 unmask lines (one per outcome, CRA) into the handoff so the humans can check how they sound
- [ ] `node src/judge/eval.js`: ≥ 12/15 match, average latency < 2 s (paste the output)
- [ ] Paste each scenario's `opening_line` and `escalation` into the handoff so the humans can check the tone
- [ ] `npm test` and `npm run check-ownership -- logic` pass

## References
- Canadian Anti-Fraud Centre, scam types and how they work: https://antifraudcentre-centreantifraude.ca/
- Government of Canada, CRA scam warnings (what the CRA will and won't do): https://www.canada.ca/en/revenue-agency/corporate/security/protect-yourself-against-fraud.html
- Get Cyber Safe (Canada) on phone scams: https://www.getcybersafe.gc.ca/
- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Node SDK: https://github.com/openai/openai-node
- Node.js test runner (`node:test`): https://nodejs.org/api/test.html
- Node.js `assert`: https://nodejs.org/api/assert.html
- MDN regular expressions guide: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions
- regex101 (test patterns, use the ECMAScript flavor): https://regex101.com/

## Launch prompt
```
You are Agent L (Logic and content). Read CLAUDE.md, SPEC.md, and roles/LOGIC.md.
Work in this order: scenarios, rules engine, ref lines, AI judge. Keep every
exported signature from the existing stubs. Only edit paths you own. Finish by
running the acceptance checklist and updating handoff/logic.md.
```
