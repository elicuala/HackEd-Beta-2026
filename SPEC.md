# Scam Drill: project specification

**Version 1.2 · Hackathon build · 3 people, 3 Claude Code agents, working in parallel**

> "Scammers practice on your grandparents every day. We let them practice back."

**What changed in 1.2** (after the first merge):
- **The live board (§5.11):** drills a person chooses to share stream live to anyone on the site (`/live.html`). Watchers get a separate `watchId`, never the `callId`.
- **Opt-in sharing:** `POST /api/voice/session` and `POST /api/phone/start` take an optional `shareLive: true` and return `watchId`. The browser call is `VoiceClient.start(scenarioId, { shareLive })`.
- **Spoken-number redaction (§5.10):** transcripts now hide spoken numbers ("four five one two" → "• • • •"), not just digits (`redactSpeech` in the contract).
- **Rules events carry the turn time:** the logic team's change request.
- **Built:** the full frontend (drill, report, phone, live board, demo mode, music), and phone drills (Part 2).

**What changed in 1.1** (made before any role work started, so nobody has to rework anything):
- **New §0 (how we win):** prize targets, a judging map, the Ref's view, the music plan, and the demo script. Also new: §10 (Devpost) and judging gates in §7.
- **The unmask (§1, §5.7):** the reveal is now spoken **in the scammer's own voice**, as it drops the act. `VoiceClient` gains `unmask(text)` and a `"scammer_speaking"` status.
- **Sound identity (§5.1):** `RefScript.sound` is now `"whistle" | "red_card" | "chime" | "fanfare" | null` (it was `"buzzer" | "chime"`). Agent L's ref picks the sound, the browser and the phone both play it, and the core drops any unknown sound.
- **Downgrade reasons (§5.1, §5.2):** when the core turns a strike into a warning, it now tags the event with `downgraded`, so the Ref's view can show why.
- **Decline (§1):** answering is now part of the drill. Declining the call is celebrated on the drill page, with no report card.
- **Storage:** a frontend-only `scamDrill.music` key (§5.8).
- The foundation code, fixtures, and tests are already updated (`npm test` passes; 109 tests as of 1.2).

## 0. How we win (read this before building anything)

### 0.1 Prize targets, in priority order
| Priority | Category | Entered? | Why |
|---|---|---|---|
| **1** | **Main track** ($500 / $250 / $250) | Automatic | Judges score **Execution, Complexity, Polish, Originality, Utility**, 1 to 5 each (25 max). Every feature decision is checked against §0.2. |
| 2 | **Best Looking Project** | ✅ Select on Devpost | Polish is already a main-track criterion, so visual work counts twice. |
| 2 | **Best Inclusion of Music** | ✅ Select on Devpost | An adaptive soundtrack that reacts to the drill (§0.4). Frontend only, no new dependencies, and it also raises Polish. |
| – | Best Soloist | ❌ | We're a team of three, so we're not eligible. |
| – | Best Environmental Project | ❌ | We don't have an honest fit. A stretched claim costs credibility with the same judges who score the main track. |
| – | Hidden categories | Can't target | Likely themes (social good, accessibility, use of AI, best pitch) are covered by doing the main track well. |

**The rule:** main-track work always beats category work. Music and motion are built only after the browser drill works end to end (sync 2). If they threaten the demo, they get cut.

### 0.2 Judging map: what earns a 5
| Criterion | A 5 looks like | How we earn it | Owner |
|---|---|---|---|
| **Execution** | The live demo works the first time, with no dead air | Mock fallback (`?mock=1`) one keypress away, a backup video, 3 rehearsals, voice latency ≤ 1.5 s, every error state friendly | All |
| **Complexity** | Judges can *see* that it's hard | Realtime voice over WebRTC, a **two-layer ref** (deterministic rules plus an LLM judge with confidence gating), a spoken-number normalizer, live SSE, and a real phone call (stretch). Shown in the **Ref's view** panel (§0.3) and an architecture diagram on Devpost | L and B build it, F shows it |
| **Polish** | It feels like a shipped product, not a hackathon page | A design system, purposeful motion, sound design, a printable report card, no console errors | F (with L's ref lines) |
| **Originality** | "I haven't seen that before" | The **unmask**: the scammer's own voice drops the act mid-call and coaches you on the trick it just used. Realistic AI phone voices are turned from the threat into the vaccine. The ref is a sports official with a whistle, strikes, and a red card | All (B voices the unmask, L writes it) |
| **Utility** | A real person would use it tomorrow | Seniors-first accessibility (WCAG 2.2 AA), Canadian scam scripts based on CAFC and CRA guidance, one takeaway habit per drill, and nothing is saved | L (content), F (accessibility) |

### 0.3 Make the complexity visible: the Ref's view
Judges score what they can see. The live drill page has a collapsible **"Ref's view"** panel (open by default during the demo, closed for real users). It shows each `RefEvent` as it arrives with its tier, `type`, redacted quote, **source** ("Rules" or "AI judge") and **confidence** (for example "AI judge · 86%"), plus the reason whenever the core downgraded a strike: `downgraded: "low_confidence"` ("AI wasn't sure enough to call a strike") or `"repeat_type"` ("already called"). All of this comes from `RefEvent` (§5.1).

### 0.4 Music and sound (Best Inclusion of Music)
In the browser, all of it is built by Agent F with the Web Audio API: no audio files are required, there are no new dependencies, and it's driven by the `WireAction`s and voice-client statuses the page already receives. Details are in `roles/FRONTEND.md`.
- **Adaptive tension score:** a quiet generative soundtrack during the live drill that gains a layer with each strike (a pulse, a faster tempo, then a minor drone), lifts on `good_defense`, ducks while the scammer speaks (`"scammer_speaking"`) or the ref speaks, and stops dead at the reveal.
- **The ref's sound identity (`RefScript.sound`, chosen by Agent L's ref):** a referee `whistle` for strikes, a `red_card` sting for autofails, a two-note `chime` for credit and for a three-strike reveal, and a short victory `fanfare` for `passed`. Agent F synthesizes these in the browser, and Agent B plays simple tone versions of them on the phone.
- **Visualized:** a live visualizer of the score on the call screen, and a **"Replay your drill"** button on the report card that plays the timeline back as a 10-second melody (defenses rise, strikes fall) while each event card lights up in turn.
- A clear **Music on/off** toggle that is remembered per browser.

### 0.5 The 3-minute demo (rehearse this exact script)
Use a **speaker, not headphones**, so judges hear the scammer, the ref, and the music. Test speaker mode at sync 2 (echo can leak into the mic). If it's bad, the "grandparent" wears a headset mic while the output goes to the speaker.
1. **Hook (15 s):** the tagline, plus the latest Canadian Anti-Fraud Centre reported-loss figure (look it up and cite it on Devpost, don't guess).
2. **Live drill (90 s):** a teammate plays a grandparent on the CRA scenario. The incoming-call screen rings and they answer. They name their bank, the whistle blows, strike 1 lights up, and the score tightens. Then they read out a fake card number: red card, the music cuts, and **the same scammer voice drops the act** ("This was a Scam Drill…") and explains the trick it used.
3. **Report card (30 s):** the timeline, "What you did well", the takeaway, and **Replay your drill** playing the call back as music.
4. **Under the hood (30 s):** open the Ref's view (rules vs AI judge, confidence), show the architecture slide, and if the stretch works, ring a teammate's phone live.
5. **Close (15 s):** "Nothing is recorded. Five minutes of practice beats a lifetime of savings."

**Demo goal:** the §0.5 script runs clean twice in a row.

## 1. Product

Scam Drill is a fire drill for phone scams. A person who opted in gets a call from an AI scammer, in the browser or on a real phone. A ref (a calm sports official) scores the call live in three tiers: warnings, strikes, and a red card. When the drill ends, **the scammer's own voice drops the act** and explains the tactic that almost worked (the unmask). Then the person gets a report card with one habit to keep, and can replay their drill as music.

The drill flow is **incoming call (Answer or Decline) → live call → unmask → report card**. Declining an unknown caller is the safest move there is, so Decline gets celebrated on the drill page ("Not answering unknown numbers is a great habit") with an "Answer this time" button to practise anyway. No call is created, so there's no report card.

**Must work:** a browser drill with live strikes, the ref's whistle and voice, a reveal, and a report card.
**Polish (after sync 2):** Agent F builds the visual design system, the incoming-call screen, motion, the Ref's view, and the music from §0.4. Agent B builds the unmask in the scammer's voice (§5.7).
**Stretch (only if the browser drill works by hour 12):** a real phone call through Twilio, with a live strike dashboard. This is the strongest Complexity and Originality moment, so Agent B goes for it the moment sync 2 says go.

**Pages:** `/` (the drill, with the incoming call, the Ref's view, and the report card), `/live.html` (the live board: anyone can watch shared drills as they happen), `/phone.html` (phone drills), `/report.html` (a printable report card). `?mock=1` plays a scripted demo call with no microphone or API key. `?judge=1` opens the Ref's view.

**Out of scope:** user accounts (the live board is public and needs no login), a database, storing recordings, scheduling drills, mobile apps, translations.

## 2. Team

| Person | Agent | Role | One-line mission |
|--------|-------|------|------------------|
| P1 | **Agent F** | Frontend | Every page the user sees, the visual design, the music, and playing the ref's sounds and voice (Best Looking and Music entries) |
| P2 | **Agent B** | Backend and voice | Live voice in the browser and on the phone, the unmask, plus the HTTP API |
| P3 | **Agent L** | Logic and content | Rules engine, AI judge, scam scenarios, and the ref's lines, sounds, and unmask script |

Each person runs **one** Claude Code agent on **one** branch on **their own laptop.** Role details are in `roles/FRONTEND.md`, `roles/BACKEND.md`, and `roles/LOGIC.md`.

## 3. Repository layout and ownership

The machine-readable version is `ownership.json` (the longest matching path wins). `npm run check-ownership -- <role>` fails if a branch touched a file it doesn't own.

```
scam-drill/
├── SPEC.md, CLAUDE.md, roles/, ownership.json      FOUNDATION (locked)
├── package.json, package-lock.json, server.js      FOUNDATION (locked)
├── .env.example, .gitignore                        FOUNDATION (locked)
├── scripts/  (check-ownership.js, simulate.js)     FOUNDATION (locked)
├── test/     (foundation.test.js, fixtures/)       FOUNDATION (locked)
├── src/
│   ├── shared/contract.js                          FOUNDATION (locked)
│   ├── core/  (callState, pipeline, calls, bus, routes)  FOUNDATION (locked)
│   ├── rules/                                      Agent L
│   ├── judge/                                      Agent L
│   ├── scenarios/                                  Agent L
│   ├── ref/                                        Agent L
│   ├── voice/                                      Agent B
│   ├── phone/                                      Agent B
│   └── live/                                       Agent B   ← the live board
├── public/
│   ├── js/voice-client.js                          Agent B   ← the only Backend file in public/
│   └── everything else                             Agent F
└── handoff/
    ├── frontend.md                                 Agent F
    ├── backend.md                                  Agent B
    └── logic.md                                    Agent L
```

**The foundation is already written and tested** (`npm test` passes; 109 tests as of 1.2). It includes working placeholders ("stubs") in `src/rules`, `src/judge`, `src/scenarios`, and `src/ref`, so the whole app runs from minute one. Agent L replaces those stubs. Nobody else touches them.

## 4. Locked foundation and change requests

No agent edits foundation files. If an agent believes a foundation file or contract has to change:
1. It stops working on that part.
2. It writes a **change request** at the top of its `handoff/<role>.md`:
   ```
   ## CHANGE REQUEST
   File: src/shared/contract.js
   Change: <exact change>
   Why: <what breaks without it>
   Affects: <which roles>
   ```
3. Its human brings it to the other two. If all three agree, **only P2 (or whoever is the merger) edits the foundation on `main`**, and everyone pulls.

Adding an npm dependency counts as a foundation change. Agents never run `npm install <pkg>`.

## 5. Contracts

Everything below is fixed. Agents code against these, never against each other's code.

### 5.1 Data types (`src/shared/contract.js`)

```js
Turn       { speaker: "victim" | "scammer", text: string, t: number }      // t = seconds since call start
RefEvent   { tier: "autofail" | "strike" | "warning" | "good_defense",
             type: string,          // e.g. "card_number", "secrecy", "urgency"
             quote: string,         // REDACTED: digits replaced with •
             source: "rules" | "ai",
             confidence: number,    // 0..1, rules always 1
             t: number,
             downgraded?: "low_confidence" | "repeat_type" }   // set ONLY by the core (§5.2)
RefScript  { say: string | null,    // the core redacts digits as a safety net
             sound: "whistle" | "red_card" | "chime" | "fanfare" | null }  // unknown → null (core)
WireAction { type: "strike_called" | "warning_shown" | "credit_shown" | "reveal",
             callId: string,
             ref: RefScript,
             event?: RefEvent,                // strike_called, warning_shown, credit_shown
             strikeNumber?: 1 | 2 | 3,        // strike_called
             outcome?: "passed" | "failed_strikes" | "failed_autofail",  // reveal
             events?: RefEvent[],             // reveal
             scenarioId?: string, scenarioTitle?: string, endedAt?: string }  // reveal
Scenario   { id, title, blurb, opening_line, goal, escalation: string[],
             red_flag_phrases: string[], backs_off_when, system_prompt }
```

**RevealResult** = the `reveal` WireAction. The frontend stores it as-is. Examples: `test/fixtures/reveal-*.json`.

### 5.2 Game rules (implemented in `src/core`, never re-implement)

- Any `autofail` → reveal, `failed_autofail`
- The 3rd `strike` → reveal, `failed_strikes`
- An AI `strike` with confidence < 0.8 → downgraded to `warning`, tagged `downgraded: "low_confidence"`
- A second strike of the same `type` → downgraded to `warning`, tagged `downgraded: "repeat_type"`
- An AI `autofail` → rejected
- The victim says "drill" or "stop" (whole word), presses End, or hangs up while live → reveal, `passed`
- Events after a reveal are ignored

### 5.3 Module interfaces (Agent L implements, the foundation calls them)

```js
// src/rules/index.js
checkRules({ victimLine /* RAW */, lastScammerLine, secondsSinceRedFlag, alreadyStruck /* Set<string> */ }) → RefEvent[]
// pure, synchronous, < 5 ms, source "rules", never throws (the foundation catches anyway)

// src/judge/index.js
judgeTurn({ recentTurns /* REDACTED Turn[], last 6 */, scenario }) → Promise<RefEvent[]>
// never throws, returns [] on any error, never returns autofail

// src/scenarios/index.js
getScenario(id) → Scenario           // throws { code: "SCENARIO_NOT_FOUND", status: 404 }
listScenarios() → { id, title, blurb }[]

// src/ref/index.js
scriptFor(action) → RefScript        // no digits in `say`, kind tone, picks the sound (§0.4)
// For reveal, `say` is the unmask line: the scammer voice speaks it out of character (§5.7)
```

### 5.4 Server-side call API (foundation, Agent B calls it)

```js
import { createCall, processTurn, endCall, getCall } from "../core/calls.js";
createCall({ scenarioId, channel: "browser" | "phone" }) → { callId, scenario }
processTurn(callId, turn /* RAW text */) → Promise<WireAction[]>   // serialized per call
endCall(callId) → Promise<WireAction[]>                              // [] if already revealed
getCall(callId) → state snapshot | null
```
Every action is also published to `GET /api/stream?callId=` automatically.

### 5.5 HTTP API

All JSON. Errors are always `{ "error": { "code": "UPPER_SNAKE", "message": "..." } }` with a matching HTTP status.

| Method and path | Owner | Request | Response 200 |
|---------------|-------|---------|--------------|
| `GET /api/health` | foundation | | `{ ok: true }` |
| `GET /api/scenarios` | L | | `[{ id, title, blurb }]` |
| `GET /api/stream?callId=` | foundation | | SSE, see 5.6 |
| `POST /api/voice/session` | B | `{ scenarioId, shareLive? }` | `{ callId, clientSecret, model, voice, openingLine, watchId }` (`watchId` is null unless shared) |
| `POST /api/voice/turn` | B | `{ callId, turn: Turn }` | `{ actions: WireAction[] }` |
| `POST /api/voice/end` | B | `{ callId }` | `{ actions: WireAction[] }` |
| `GET /api/phone/numbers` | B | | `[{ id: "n1", label: "•••• 1234" }]` (never the full number) |
| `POST /api/phone/start` | B | `{ numberId, scenarioId, shareLive? }` | `{ callId, watchId }` |
| `POST /twilio/voice` | B | Twilio webhook | TwiML |
| `WS /twilio/stream` | B | Twilio Media Stream (only for calls this server placed) | |
| `GET /api/live` | B | | `[{ watchId, title, scenarioId, channel, status, outcome, strikes, startedAt, endedAt, lines, lastLine }]`, newest first |
| `GET /api/live/stream?watchId=` | B | | SSE, see 5.11 |

Error codes in use: `DRILL_NOT_FOUND` (404, live board), `SCENARIO_NOT_FOUND` (404), `CALL_NOT_FOUND` (404), `BAD_REQUEST` (400), `NUMBER_NOT_ALLOWED` (403), `PHONE_DISABLED` (503, Twilio env vars missing), `UPSTREAM_ERROR` (502, OpenAI or Twilio failed).

### 5.6 Server-Sent Events: `GET /api/stream?callId=`

```
event: status   data: { "status": "live" | "reveal" }
event: turn     data: Turn (REDACTED)
event: action   data: WireAction
```
Unknown callId → 404 JSON. Used by the phone dashboard (and optionally the drill page).

### 5.7 Browser voice client: `public/js/voice-client.js`

**Agent B writes the real one. Agent F writes `public/js/voice-client.mock.js` with the identical interface** so the UI can be built and demoed without the backend.

```js
export function createVoiceClient(handlers) → VoiceClient

handlers = {
  onStatus(status),        // "connecting" | "live" | "scammer_speaking" | "ref_speaking" | "ended"
                           // "scammer_speaking" while scammer audio plays, then back to "live"
  onTurn(turn),            // REDACTED Turn, for an optional live transcript
  onActions(actions),      // WireAction[] from the server, in order
  onError(err),            // { code, message }
}

VoiceClient = {
  start(scenarioId, { shareLive? }) → Promise<{ callId, watchId }>  // MUST be called inside a click handler
  pauseScammer()     → void                  // mute scammer audio, stop it responding
  resumeScammer()    → void
  setRefSpeaking(on) → void                  // while true, the victim's mic transcripts are dropped (not sent to the server)
  unmask(text)       → Promise<boolean>      // after a reveal: the scammer voice says `text` out of character.
                                             // Resolves true when it finished speaking, false if it can't
                                             // (then the caller falls back to speechSynthesis). Never rejects.
  end()              → Promise<void>         // asks the server to end; the reveal arrives through onActions
}
```
Rules for both implementations:
- They never touch the DOM. Audio plays through `new Audio()` created off the page.
- They never call `alert`, `confirm`, or navigate.
- **On a `reveal` action:** stop the mic and stop sending turns straight away, but keep the scammer audio connection open for `unmask()`. Close everything and call `onStatus("ended")` once `unmask()` resolves, or after **15 s** if it's never called.
- `unmask(text)` must cut off any in-progress scammer reply first, then make the model say `text` **verbatim and out of character**, and resolve when that audio has finished (cap it at 15 s). The mock resolves `false` immediately.
- `"scammer_speaking"` is best-effort: if the client can't detect speech, it never emits it, and the UI must still work.

### 5.8 Browser storage

| Key | Storage | Written by | Read by | Value |
|-----|---------|-----------|---------|-------|
| `scamDrill.result` | `sessionStorage` | F (`drill.js`, `phone.js`) | F (`report.js`) | RevealResult JSON |
| `scamDrill.music` | `localStorage` | F (`audio/engine.js`) | F | `"on"` or `"off"` (added in 1.1, F only) |

### 5.9 Environment variables

See `.env.example`. Agents read them through `process.env` only. Server code must start with any of them blank: features that need a missing key return `PHONE_DISABLED` or `UPSTREAM_ERROR`, never crash.

### 5.10 Privacy (non-negotiable, every role)

- Every `quote` and every logged string is redacted (no digits). Anything shown to other people (transcripts, the live board) also hides spoken numbers (`redactSpeech`).
- Never write audio, raw transcripts, or keys to disk or logs.
- The browser never sees `OPENAI_API_KEY` or Twilio credentials. It only gets a short-lived `clientSecret`.
- Phone drills only call numbers in `ALLOWED_NUMBERS`, and the browser only ever sees masked labels.
- The live board is **opt-in per drill** ("Show on the live board", on by default with a clear label). Watchers never get the `callId`, which can drive or end a call. Drills drop off the board 15 minutes after they end, and nothing is written to disk.

### 5.11 Live board: `GET /api/live/stream?watchId=`

```
event: snapshot  data: { watchId, title, channel, status, outcome, strikes, ..., items: Item[] }
event: item      data: Item
event: status    data: { status: "live" | "reveal", outcome }
event: gone      data: {}        // the drill left the board
Item = { kind: "turn", speaker, text (redactSpeech), t }
     | { kind: "action", type, strikeNumber, outcome, say, sound, event: { tier, type, quote, source, confidence, downgraded, t } | null }
```
A shared drill is **listed** once its first line is spoken, so a call that never connected doesn't show up as a ghost. Its `watchId` link works from the start. Unknown `watchId` → 404 `DRILL_NOT_FOUND`.

## 6. Git workflow

- `main` is protected by convention: only the merger (P2 by default) merges, through PRs.
- Branches: `role/frontend`, `role/backend`, `role/logic`. One agent per branch, ever.
- Commit prefix: `[F]`, `[B]`, or `[L]`, for example `[L] rules: spoken-number normalizer`.
- **Before every push:** `npm test && npm run check-ownership -- <role>`. Both must pass.
- Merge order at each sync point: **L → B → F** (each layer depends on the one before at runtime). Because the paths don't overlap, merges should never conflict. If one does, someone edited outside their paths: reject that PR.
- After any merge to `main`, all three pull and rebase: `git pull --rebase origin main`.

## 7. Timeline and sync points

| Hour | Sync point | Must be true |
|------|-----------|--------------|
| 0 | Kickoff | Everyone has read SPEC.md and their role file, `.env` is filled in, `npm test` passes on every laptop |
| 6 | **Sync 1** | L: rules and all 3 scenarios merged. B: `voice-client.js` talks to the scammer in a test page. F: drill page works end to end on the mock (`?mock=1`) |
| 10 | **Sync 2: integration** | B merged. F tests the drill page against the real voice client. **Decision:** if latency is above about 1.5 s or the voice is unstable, cut the phone stretch goal |
| 14 | Sync 3 | L: judge and ref lines merged. All 4 endings (pass, 3 strikes, autofail, "stop") work in the browser. B: the unmask works in the scammer's voice. F: design system, incoming-call screen, and Ref's view merged |
| 18 | Sync 4 | Stretch: a phone drill works with the live dashboard. F: tension score, sound identity, and "Replay your drill" merged. **Feature freeze** |
| 18–22 | Bug fixes only | Each agent fixes bugs in its own paths. **Hour 20:** take the Devpost screenshots (§10) and draft the page |
| 22–24 | Rehearsal (humans) | Run the §0.5 script 3 times on a speaker, 2 clean in a row. Record the backup video. **Submit on Devpost at least 1 hour before the deadline** |

## 8. Integration test (run at sync 2, 3, 4)

1. `npm test` is green on `main`.
2. `npm run simulate -- test/fixtures/transcript-cra-fail.json` ends with `failed_autofail` (after L merges).
3. `npm run simulate -- test/fixtures/transcript-cra-pass.json` ends with `passed`.
4. Browser, headphones on: open `/drill.html?judge=1`, pick CRA, answer the incoming call, and talk. Give your bank → strike 1 with the whistle and ref voice, and the Ref's view shows "Rules · 100%". Say a fake card number → red-card sting → **the scammer voice speaks the unmask line** → the report card shows `failed_autofail`.
5. Repeat, saying "I'll hang up and call the official number" → credit chime and toast → say "stop" → fanfare → the report card shows `passed`, and "Replay your drill" plays.
6. Decline the incoming call → the celebration panel shows, with no network call to `/api/voice/session`.
7. Repeat step 4 **on a speaker** with the music on: no scammer or music audio comes back as victim turns.
8. (Stretch) `/phone.html` → call a verified phone → strikes appear live on the dashboard, and the unmask is spoken on the phone.

## 9. Definition of done (every role, every PR)

1. `npm test` passes (foundation tests plus your own).
2. `npm run check-ownership -- <role>` passes.
3. Your role file's acceptance checklist is ticked, with any measurements written in `handoff/<role>.md`.
4. `handoff/<role>.md` says what you built, how to use it, known issues, and any change requests.

## 10. Devpost submission (humans, hour 20 onward)

First impressions count, and the Best Looking judges look at the page before they see the demo.
- **Prizes to select:** Best Looking Project and Best Inclusion of Music. Not Soloist, not Environmental (§0.1).
- **Title and tagline:** "Scam Drill: scammers practice on your grandparents every day. We let them practice back."
- **Video (≤ 3 min, with sound):** the §0.5 script. Make sure the music and the ref are clearly audible.
- **Screenshots, in this order:** (1) the incoming-call screen, (2) the live drill with 2 strikes lit and the Ref's view open, (3) the reveal, (4) the report card, (5) the landing page. Take them at 1440 px wide in light mode, plus one dark-mode shot.
- **Sections:** Inspiration (the CAFC stat), What it does, **How we built it** (an architecture diagram covering WebRTC realtime voice → the core → rules + AI judge → ref → SSE, and the phone bridge; this is where Complexity is scored), Challenges (latency, spoken numbers, keeping an AI scammer safe), Accomplishments, What we learned, What's next.
- **Privacy line:** "Drills are opt-in. Nothing you say is recorded or stored."
- **At the table:** a speaker, a charged laptop, the backup video downloaded locally, and `?mock=1` ready in a second tab.
