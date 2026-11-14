# Handoff: logic

## CHANGE REQUEST
File: src/core/pipeline.js
Change: stamp the turn time onto rule events. Either pass it in (`ctx.checkRules({ ..., t: turn.t })`) or stamp it after (`apply(ruleEvents.map((e) => ({ ...e, t: turn.t })))`).
Why: `checkRules` is never told the time, so every rules event reaches the frontend with `t: 0`. The shared reveal fixtures show real times on rules events (`t: 14`, `t: 40`), and the report-card timeline and "Replay your drill" order events by `t`. AI judge events already carry the right `t`.
Affects: foundation (one line). Frontend benefits; no other role has to change. `checkRules` already accepts an optional `t`, so the first form works the moment it is merged.

## Status
Scenarios, rules engine, ref lines, and AI judge are built and tested on `role/logic`. Every acceptance item is done, including the live judge eval.

## What I built
- **Scenarios** (`src/scenarios/`): `cra`, `grandkid`, `bank_fraud`. Each prompt has the seven required parts in order, with the guardrail, back-off, stop-word, and unmask sentences verbatim.
- **Rules engine** (`src/rules/`): `normalize.js` (spoken numbers to digits), `agreement.js` (agree vs. refuse), `autofails.js`, `strikes.js`, `index.js`.
- **Ref lines** (`src/ref/`): all wording is in `phrases.js`; `index.js` picks the line and the sound.
- **AI judge** (`src/judge/`): `index.js`, `prompt.js`, `schema.js`, `mock.js`, `cases.json`, `eval.js`.

## How to use it
Signatures are unchanged from the stubs (SPEC §5.3).

- `checkRules(...)` returns **at most one event per victim line**: an autofail alone, or else the first strike not already in `alreadyStruck`.
- `judgeTurn(...)` uses the keyword mock when `JUDGE_MOCK=1`, or when `OPENAI_API_KEY` or `JUDGE_MODEL` is blank. Otherwise it calls the OpenAI Responses API with a strict JSON schema, a 4 s timeout, and no retries.
- AI event `type` is the judge's tactic: `urgency`, `authority`, `secrecy`, `fear`, `sympathy`, `payment`, `verification` (or `general` if the model gives none).
- Rules event `type` is one of: `card_number`, `sin_number`, `password_or_code`, `gift_card`, `crypto_or_wire`, `remote_access` (autofails) and `confirmed_bank`, `confirmed_identity`, `secrecy`, `stayed_on_line`, `lingered` (strikes).
- To change any spoken line, edit `src/ref/phrases.js` only. The tests enforce the word limits and no digits.

### Decisions worth knowing
- **One strike per line.** `transcript-cra-fail.json` has a line that agrees to both secrecy and staying on the line. Calling both would make three strikes and end the drill as `failed_strikes` before the card number is read, but the role file requires that fixture to end in `failed_autofail`. So the rules call one strike per line (secrecy first). Note that `reveal-failed-strikes.json` shows two rules strikes at the same `t`, which the live engine will not produce.
- **Quotes are normalized before they are redacted.** "four five one two" becomes "••••" in the quote, matching the fixture. Without this, spoken card numbers would appear in the quote as words.
- **Numbers that are not account numbers are ignored** by the card and SIN checks: money amounts, dates and years, street addresses, ten-digit phone numbers, and counts ("2 cards").
- **The judge never sees numbers.** `prompt.js` converts spoken numbers and redacts them before the transcript is sent.
- **No red-flag phrase appears in any opening line**, so the 45-second lingering timer starts at the first real pressure line, not at "hello" (tested).

## Acceptance checklist results
- [x] `listScenarios()` returns 3 scenarios, and every prompt contains the verbatim guardrail, stop-word, and unmask sentences (tested in `src/scenarios/scenarios.test.js`)
- [x] All rules tests pass, including the guards and the performance test
- [x] `npm run simulate` gives `failed_autofail` on the fail fixture and `passed` on the pass fixture (output below)
- [x] Every ref phrase is covered, digit-free, and within its word limit, every sound is from the allowed set, and each scenario has an unmask "trick" line (tested in `src/ref/ref.test.js`)
- [x] The 3 unmask lines are pasted below
- [x] `node src/judge/eval.js`: 14/15 match, average latency 1732 ms (output below)
- [x] Each scenario's `opening_line` and `escalation` are pasted below
- [x] `npm test` (71 tests, 16 foundation plus 55 logic) and `npm run check-ownership -- logic` pass

### `node src/judge/eval.js` (real API, model from `JUDGE_MODEL`)
```
PASS  hooked-fear              expected warning      got warning      fear 97%           1856 ms
PASS  hooked-pay-now           expected strike       got strike       payment 99%        1862 ms
FAIL  hooked-sympathy          expected warning      got none                            1901 ms
PASS  hooked-authority         expected warning      got warning      authority 96%      2293 ms
PASS  hooked-urgency           expected warning      got warning      urgency 99%        1634 ms
PASS  skeptical-employee-id    expected good_defense got good_defense verification 98%   2188 ms
PASS  skeptical-call-back      expected good_defense got good_defense verification 100%  2394 ms
PASS  skeptical-prove-it       expected good_defense got good_defense verification 99%   1658 ms
PASS  skeptical-back-of-card   expected good_defense got good_defense verification 100%  1387 ms
PASS  skeptical-names-it       expected good_defense got good_defense payment 99%        1431 ms
PASS  neutral-greeting         expected none         got none                            1572 ms
PASS  neutral-repeat           expected none         got none                            1537 ms
PASS  neutral-tv               expected none         got none                            1319 ms
PASS  neutral-lunch            expected none         got none                            1382 ms
PASS  neutral-hearing          expected none         got none                            1564 ms

Match (expected or an accepted neighbour): 14/15   target: at least 12
Exact match:                               14/15
Errors or timeouts:                        0
Average latency:                           1732 ms   target: under 2000 ms
```
The first run, with the model's default reasoning, also scored 14/15 but averaged 2169 ms. The judge now sends `reasoning: { effort: "none" }` and drops the option automatically for a model that rejects it.

### `npm run simulate -- test/fixtures/transcript-cra-fail.json`
```
    0s scammer Hello, this is Officer Grant from the Canada Revenue Agency. There is an unpaid balance on your file.
    6s victim  Oh no, really? What do I owe?
         -> warning_shown warning/fear "Oh no, really? What do I owe?"
   10s scammer Which bank do you use so I can check your records?
   14s victim  I'm with TD.
         -> strike_called strike/confirmed_bank "I'm with TD."  [ref: Strike one. You told them your bank. Scammers use that to sound legit.]
   18s scammer A warrant will be issued today. Stay on the line and don't tell anyone.
   24s victim  Okay, I won't tell anyone. I'll stay on the line.
         -> strike_called strike/secrecy "Okay, I won't tell anyone."  [ref: Strike two. You agreed to keep it secret. Scammers want you cut off from people who would spot the trick.]
   30s scammer You need to pay with gift cards. Read me the card number.
   40s victim  Okay, the card number is four five one two three three four four.
         -> reveal failed_autofail  [ref: Okay, I'll drop the act. This was a Loki drill, and you're safe. Nothing you said was saved. I said a warrant was coming today so you'd panic, and that got you to read me a card number. Next time, hang up and call the official number yourself.]

Outcome: failed_autofail  strikes: 2  events: 4
```

### `npm run simulate -- test/fixtures/transcript-cra-pass.json`
```
    0s scammer Hello, this is Officer Grant from the Canada Revenue Agency. There is an unpaid balance on your file.
    5s victim  What's your employee ID number?
         -> credit_shown good_defense/verification "What's your employee ID number?"
    9s scammer That's not important. A warrant will be issued today if you don't pay.
   15s victim  The CRA doesn't threaten arrest over the phone. I'm going to hang up and call the number on the official website.
         -> credit_shown good_defense/verification "The CRA doesn't threaten arrest over the phone. I'm going to hang up and call the number on the official website."
   21s scammer If you hang up, police will come to your house.
   24s victim  Nope. Stop.
         -> reveal passed  [ref: Okay, I'll drop the act. This was a Loki drill, and you beat me. You asked me to prove who I was, and I couldn't. Hanging up and calling the official number is exactly right.]

Outcome: passed  strikes: 0  events: 2
```

### The three unmask lines (CRA), for the humans to read aloud
- **`failed_autofail`** (card number): "Okay, I'll drop the act. This was a Loki drill, and you're safe. Nothing you said was saved. I said a warrant was coming today so you'd panic, and that got you to read me a card number. Next time, hang up and call the official number yourself."
- **`failed_strikes`** (third strike was staying on the line): "Okay, I'll drop the act. This was a Loki drill, and you're safe. Nothing you said was saved. I said a warrant was coming today so you'd panic, and that kept you on the line with me. Next time, hang up and call the official number yourself."
- **`passed`** (asked for proof): "Okay, I'll drop the act. This was a Loki drill, and you beat me. You asked me to prove who I was, and I couldn't. Hanging up and calling the official number is exactly right."

The other two scenarios open their trick with "I played your scared grandchild so you'd rush to help" and "I posed as your bank's fraud team so you'd trust me".

### Scenario openings and escalation, for a tone check
**`cra`: Tax agency call**
Opening: "Hello, this is Officer Grant calling from the Canada Revenue Agency regarding an urgent matter with your tax file."
1. Say there is an unpaid balance on their tax file and that penalties are growing every day.
2. Ask which bank they use so you can check their records.
3. Say a warrant for their arrest will be issued today unless the balance is paid right now.
4. Tell them to stay on the line and not to tell anyone, because the case is confidential.
5. Tell them to pay with gift cards from a nearby store and read the card numbers to you over the phone.

**`grandkid`: Grandchild in trouble**
Opening: "Hello? It's me, your grandchild. I'm so glad you picked up. Can you hear me okay?"
1. Say you were in a car accident and now you are in jail.
2. Beg them not to tell Mom or Dad, and to keep this between the two of you.
3. Say a lawyer told you that you need bail money today or you will stay in jail overnight.
4. Ask them to stay on the line while they get the money ready.
5. Ask them to send the bail money by e-transfer or wire right now.

**`bank_fraud`: Bank fraud department**
Opening: "Hello, this is Alex from the fraud department at your bank. We've noticed some suspicious charges on your card."
1. Say there are suspicious charges on their card and that you have put a temporary hold on it to protect them.
2. Ask them to confirm their full name and date of birth so you can pull up the file.
3. Tell them to stay on the line, or the account will be locked.
4. Ask them to read out the card number so you can verify the card.
5. Say you are texting them a verification code, and ask them to read the code back to you.

## Known issues
- **Judge latency is close to the target** (1.7 s average, single calls up to 2.4 s, one run of 15 calls). The judge runs after the rules, so strikes from the rules are not delayed by it, but AI warnings and credits arrive about 2 s after the line.
- **The judge is cautious about sympathy.** It gave `none` for "Oh sweetie, are you okay? Tell me what you need." in the grandchild scenario, where the case expects a warning.
- **Rule events have `t: 0`** until the change request above is merged.
- **Agreement is keyword-based.** A bare "okay" right after the scammer asks for gift cards, a transfer, or a download counts as agreeing and is a red card. Sceptical questions ("Okay, but why gift cards?") and any refusal word do not. Expect the odd false red card on filler "okay"s in a live call.
- **`lingered` will fire in most long calls**: any victim line more than 45 s after the first red-flag phrase is a strike. In the demo script this could land as an extra strike before the card-number moment if the call runs long. Rehearse the timing, or raise `LINGER_SECONDS` in `src/rules/strikes.js`.
- **The core's history is only digit-redacted**, so spoken numbers ("four five one two") stay as words in `history` and in SSE `turn` events. Event quotes and the judge input are fully scrubbed. Fixing the history would be a foundation change; I have not requested it, but it is worth a look against SPEC §5.10.
- The judge's `good_defense` type is always a tactic name (`verification`, and so on). The reveal fixtures use `asked_to_verify` and `will_call_back`, which the live judge never emits. The ref has lines for both sets.

## Requests for other roles
- **Backend (B):** send the scammer's opening line and every scammer reply through `processTurn` as `speaker: "scammer"` turns. The context rules (codes, gift cards, transfers, remote access, secrecy, stay on the line) and the lingering timer depend on `lastScammerLine`.
- **Backend (B):** the unmask line is `reveal.ref.say`. It is always under 50 words and has no digits, so it fits the 15 s cap.
- **Frontend (F):** event `type` values to label in the Ref's view and report card are listed under "How to use it". Expect `general` as a rare fallback type from the AI judge.
- **Humans:** read the three unmask lines aloud at sync 3 and tell me which words trip the voice.
