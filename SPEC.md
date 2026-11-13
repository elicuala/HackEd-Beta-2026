# Scam Drill: project specification

**Version 1.0 · Hackathon build · 3 people, 3 Claude Code agents, working in parallel**

> "Scammers practice on your grandparents every day. We let them practice back."

## 1. Product

Scam Drill is a fire drill for phone scams. A person who opted in talks to an AI scammer, in the browser or on a real phone call. A ref scores the call live in three tiers. When the drill ends, the AI drops the act and explains the tactic that almost worked, then the person gets a report card.

**Demo goal (must work):** a browser drill with live strikes, the ref's buzzer and voice, a reveal, and a report card.
**Stretch (only if the browser drill works by hour 12):** a real phone call through Twilio, with a live strike dashboard.

**Out of scope:** user accounts, a database, storing recordings, scheduling drills, mobile apps, translations.

## 2. Team

| Person | Agent | Role | One-line mission |
|--------|-------|------|------------------|
| P1 | **Agent F** | Frontend | Every page the user sees, and playing the ref's sounds and voice |
| P2 | **Agent B** | Backend and voice | Live voice in the browser and on the phone, plus the HTTP API |
| P3 | **Agent L** | Logic and content | Rules engine, AI judge, scam scenarios, and the ref's lines |

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
│   └── phone/                                      Agent B
├── public/
│   ├── js/voice-client.js                          Agent B   ← the only Backend file in public/
│   └── everything else                             Agent F
└── handoff/
    ├── frontend.md                                 Agent F
    ├── backend.md                                  Agent B
    └── logic.md                                    Agent L
```

**The foundation is already written and tested** (`npm test` passes 13 tests). It includes working placeholders ("stubs") in `src/rules`, `src/judge`, `src/scenarios`, and `src/ref`, so the whole app runs from minute one. Agent L replaces those stubs. Nobody else touches them.

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
             t: number }
RefScript  { say: string | null, sound: "buzzer" | "chime" | null }
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
- An AI `strike` with confidence < 0.8 → downgraded to `warning`
- A second strike of the same `type` → downgraded to `warning`
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
scriptFor(action) → RefScript        // no digits in `say`, kind tone
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
| `POST /api/voice/session` | B | `{ scenarioId }` | `{ callId, clientSecret, model, voice, openingLine }` |
| `POST /api/voice/turn` | B | `{ callId, turn: Turn }` | `{ actions: WireAction[] }` |
| `POST /api/voice/end` | B | `{ callId }` | `{ actions: WireAction[] }` |
| `GET /api/phone/numbers` | B | | `[{ id: "n1", label: "•••• 1234" }]` (never the full number) |
| `POST /api/phone/start` | B | `{ numberId, scenarioId }` | `{ callId }` |
| `POST /twilio/voice` | B | Twilio webhook | TwiML |
| `WS /twilio/stream` | B | Twilio Media Stream | |

Error codes in use: `SCENARIO_NOT_FOUND` (404), `CALL_NOT_FOUND` (404), `BAD_REQUEST` (400), `NUMBER_NOT_ALLOWED` (403), `PHONE_DISABLED` (503, Twilio env vars missing), `UPSTREAM_ERROR` (502, OpenAI or Twilio failed).

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
  onStatus(status),        // "connecting" | "live" | "ref_speaking" | "ended"
  onTurn(turn),            // REDACTED Turn, for an optional live transcript
  onActions(actions),      // WireAction[] from the server, in order
  onError(err),            // { code, message }
}

VoiceClient = {
  start(scenarioId)  → Promise<{ callId }>   // MUST be called inside a click handler (mic and audio permission)
  pauseScammer()     → void                  // mute scammer audio, stop it responding
  resumeScammer()    → void
  setRefSpeaking(on) → void                  // while true, the victim's mic transcripts are dropped (not sent to the server)
  end()              → Promise<void>         // asks the server to end; the reveal arrives through onActions
}
```
Rules for both implementations:
- They never touch the DOM. Audio plays through `new Audio()` created off the page.
- They never call `alert`, `confirm`, or navigate.
- After a `reveal` action, they stop all audio and the mic, then call `onStatus("ended")`.

### 5.8 Browser storage

| Key | Storage | Written by | Read by | Value |
|-----|---------|-----------|---------|-------|
| `scamDrill.result` | `sessionStorage` | F (`drill.js`, `phone.js`) | F (`report.js`) | RevealResult JSON |

### 5.9 Environment variables

See `.env.example`. Agents read them through `process.env` only. Server code must start with any of them blank: features that need a missing key return `PHONE_DISABLED` or `UPSTREAM_ERROR`, never crash.

### 5.10 Privacy (non-negotiable, every role)

- Every `quote` and every logged string is redacted (no digits).
- Never write audio, raw transcripts, or keys to disk or logs.
- The browser never sees `OPENAI_API_KEY` or Twilio credentials. It only gets a short-lived `clientSecret`.
- Phone drills only call numbers in `ALLOWED_NUMBERS`, and the browser only ever sees masked labels.

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
| 14 | Sync 3 | L: judge and ref lines merged. All 4 endings (pass, 3 strikes, autofail, "stop") work in the browser |
| 18 | Sync 4 | Stretch: a phone drill works with the live dashboard. **Feature freeze** |
| 18–22 | Bug fixes only | Each agent fixes bugs in its own paths |
| 22–24 | Rehearsal (humans) | 3 full runs, 2 clean in a row, backup video recorded |

## 8. Integration test (run at sync 2, 3, 4)

1. `npm test` is green on `main`.
2. `npm run simulate -- test/fixtures/transcript-cra-fail.json` ends with `failed_autofail` (after L merges).
3. `npm run simulate -- test/fixtures/transcript-cra-pass.json` ends with `passed`.
4. Browser, headphones on: open `/drill.html`, pick CRA, talk. Give your bank → strike 1 with the buzzer and ref voice. Say a fake card number → the reveal plays → the report card shows `failed_autofail`.
5. Repeat, saying "I'll hang up and call the official number" → credit toast → say "stop" → the report card shows `passed`.
6. (Stretch) `/phone.html` → call a verified phone → strikes appear live on the dashboard.

## 9. Definition of done (every role, every PR)

1. `npm test` passes (foundation tests plus your own).
2. `npm run check-ownership -- <role>` passes.
3. Your role file's acceptance checklist is ticked, with any measurements written in `handoff/<role>.md`.
4. `handoff/<role>.md` says what you built, how to use it, known issues, and any change requests.
