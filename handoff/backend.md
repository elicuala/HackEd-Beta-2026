# Handoff: backend

<!-- If you need a foundation change, put a CHANGE REQUEST block here first (SPEC.md §4). -->

## CHANGE REQUEST (small, non-blocking): APPLIED on main in the merge-fixes commit
File: scripts/check-ownership.js
Change: use `git status --porcelain -uall` instead of `git status --porcelain`.
Why: without `-uall`, git collapses a brand-new untracked folder into one line (`public/`). The check then blames the folder's owner (frontend) for Agent B's `public/js/voice-client.js` until that file is committed. The workaround is to commit first, then run the check.
Affects: all roles (any role adding the first file in a new folder).

## Status
- **Part 1 (browser voice):** code complete and tested (unit tests, plus an end-to-end run in headless Chrome). It still needs the live test with a real key, a mic, and headphones (see the checklist).
- **Part 2 (phone):** code complete and unit-tested with Twilio and OpenAI faked. It still needs a live test with Twilio keys and ngrok.
- **Live board (`src/live/`):** ~~done and tested (SPEC §5.11)~~ **removed on Nov 13, 2026** by P1 (Agent F) at the team's request, together with `shareLive`/`watchId` in `src/voice/routes.js`, `src/phone/routes.js`, `public/js/voice-client.js` and their tests. Details and the SPEC change request are in `handoff/frontend.md`.
- **"Take over call" (Nov 13, 2026, by Agent F in your files, please review):** `src/phone/bridge.js` got a `human` phase and `takeOver(ws)` (cuts the AI off, closes the OpenAI socket, relays Twilio media ⇄ the browser socket as `{ event: "media", payload }`, `{ event: "end" }` or the socket closing hangs up and `endCall`s). `src/phone/routes.js` keeps a `callId → bridge` map (`onStarted`/`onClosed` deps) and upgrades `/phone/takeover?callId=` (close `4404 NO_LIVE_CALL` when there's no live line). Two bridge tests were added in `phone.test.js`. Not run: no Node on P1's machine.

## Plan (written before coding)

### Sources checked (Nov 2026 docs, not memory)
- Realtime WebRTC guide: the server mints an ephemeral secret with `POST https://api.openai.com/v1/realtime/client_secrets` (body `{ expires_after, session: { type: "realtime", model, instructions, audio: { input: { transcription, turn_detection, noise_reduction }, output: { voice } } } }`, response `{ value: "ek_…", expires_at, session }`). The browser then POSTs its SDP offer to `https://api.openai.com/v1/realtime/calls` with `Authorization: Bearer ek_…` and `Content-Type: application/sdp`, and gets the SDP answer back as text. The data channel is `oai-events`.
- GA event names used: `response.created`, `response.done`, `response.output_audio_transcript.done`, `conversation.item.input_audio_transcription.completed`, `output_audio_buffer.started` / `.stopped` / `.cleared` (WebRTC only, each with `response_id`), `input_audio_buffer.speech_stopped`, and `error`. Client events: `response.create` (with `instructions` and `metadata`), `response.cancel`, and `output_audio_buffer.clear`.
- `response.create.response.metadata` is echoed on `response.created`, so I tag responses (`opening`, `unmask`) and match later events by `response_id`.

### Server: `src/voice/`
| File | Job |
|---|---|
| `config.js` | Reads env lazily: `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL` (default `gpt-realtime-2.1`), `OPENAI_REALTIME_VOICE` (default `cedar`), and an optional `OPENAI_TRANSCRIBE_MODEL` (default `gpt-4o-transcribe`). |
| `secret.js` | `mintClientSecret({ instructions }, { fetchImpl })`. Uses plain `fetch` with an 8 s timeout. A missing key, a non-2xx response, a timeout, or a bad body all become `UPSTREAM_ERROR` 502. Logs the code and HTTP status only. |
| `validate.js` | Request-body validation (`BAD_REQUEST` 400) and the SPEC §5.5 error helper. |
| `routes.js` | `POST /api/voice/session`, `/turn`, `/end`, `GET /dev/voice`. `register(app, deps)`, so tests can inject a fake minter. |
| `dev.html` | A private test page: scenario picker, Start/End, pause/resume, ref-speaking toggle, unmask test, a live log, and **automatic latency measurement** (speech stopped → first scammer audio). |
| `voice.test.js` | Route validation and error shapes with OpenAI mocked (no network), plus the browser client driven by fake WebRTC objects. |

Session order: `getScenario` (404 first) → mint secret → `createCall`, so a failed mint leaves no orphan call. `Cache-Control: no-store` on the secret. `/turn` and `/end` only accept browser-channel calls.

Session config: `semantic_vad` would interrupt seniors less but adds latency. I'm starting with `server_vad` (`silence_duration_ms` 600, `interrupt_response` true) and will tune it at the latency test. `noise_reduction: near_field`, transcription language `en`.

### Browser: `public/js/voice-client.js` (SPEC §5.7)
- `start()`: create the off-DOM `Audio` synchronously (inside the click), then run the session POST **and** `getUserMedia` in parallel (saves a round trip), with the echo cancellation, noise suppression, and auto gain constraints. Then the peer connection, data channel, offer, the POST to `/v1/realtime/calls`, and the answer. Wait for the data channel to open (10 s timeout), then status `live`, set `t0`, resolve `{ callId }`, and send a tagged `response.create` that has the scammer say `openingLine`.
- **Turns:** a single promise queue. Scammer transcripts (except the unmask's) and victim transcripts (dropped while the ref is speaking, while not live, or when empty) are posted one at a time. `onTurn(redacted)` fires first, then the POST, then `onActions`. A failed POST is retried once. `CALL_NOT_FOUND` becomes `CONNECTION_LOST`.
- **`pauseScammer()`:** mute, `response.cancel` + `output_audio_buffer.clear`, and cancel any response created while paused. **`resumeScammer()`:** unmute, and if a reply was cancelled while paused, ask for a fresh one so there's no dead air after the ref.
- **`setRefSpeaking(on)`:** drop transcripts **and** disable the mic track (so the ref's speaker audio can't trigger the scammer's VAD), and emit `ref_speaking` / `live`.
- **`scammer_speaking`:** from `output_audio_buffer.started` / `.stopped`.
- **Reveal:** stop the mic and the queue straight away, cancel and clear any scammer reply, pass the actions on, and start the 15 s close timer.
- **`unmask(text)`:** cancel and clear, unmute, then a tagged `response.create` ("The drill is over. Step out of character and say exactly this…"). Resolve `true` on that response's `output_audio_buffer.stopped`, and `false` if it fails, never starts within 4 s (fast fallback to `speechSynthesis`), or the connection is gone. Cap it at 15 s. Then close everything and emit `ended`.
- **`end()`:** queued behind pending turns, then `POST /api/voice/end`, and the actions go through the same path.
- **Errors:** `MIC_DENIED`, `SESSION_FAILED`, `CONNECTION_LOST`, and `UPSTREAM_ERROR`, sent through `onError`. `start()` also rejects with the same object, so callers should catch it.
- An optional, non-contract `onDebug(event)` handler feeds the dev page's latency meter. A second, optional `deps` argument injects fakes for tests.


## What I built
- `src/voice/config.js`, `secret.js`, `validate.js`, and `routes.js`: the three endpoints from SPEC §5.5, plus `GET /dev/voice`. Malformed JSON on `/api/voice/*` returns 400 `BAD_REQUEST` (it used to fall through to a generic `INTERNAL`).
- `public/js/voice-client.js`: SPEC §5.7 in full, including `unmask()` and `"scammer_speaking"`.
- `src/voice/dev.html`: the test page with a latency meter.
- `src/voice/voice.test.js`: 18 tests. The routes run with OpenAI mocked, and the client runs against fake WebRTC (start, turn ordering and redaction, ref speaking, pause/resume, the reveal → unmask → ended flow, the unmask fallback, the reveal timeout, mic denied, upstream 502, and a dropped connection). No network.

## Part 2 and the live board (built after the first merge)
- **`src/phone/`:**
  - `config.js`: env, masked numbers, the stream URL.
  - `mulaw.js`: G.711 μ-law encoder and the ref's sounds as phone tones.
  - `bridge.js`: one Twilio Media Stream ↔ one OpenAI Realtime WebSocket. The session runs in `audio/pcmu` both ways, so there's no conversion. Finished transcripts go to `processTurn`. Barge-in clears Twilio's buffer.
    - A strike plays the whistle tone, then the ref speaks out of band (`conversation: "none"`, so the scammer's context stays clean). Caller audio is held while the ref talks.
    - A reveal plays its tone, then the unmask in the scammer's voice, then Twilio hangs up.
    - If the caller hangs up, `endCall` runs (→ `passed`).
  - `routes.js`: `GET /api/phone/numbers`, `POST /api/phone/start`, `POST /twilio/voice` (signature-checked), and `attach()` for `WS /twilio/stream`. Only calls this server placed can open a stream, once each, and only with a matching CallSid.
- **`src/live/`:**
  - `board.js`: an in-memory board fed by the core's bus, for opted-in calls only. Watchers get a random `watchId`, never the `callId`. Text goes through `redactSpeech`. A drill is listed once its first line is spoken (no ghost drills from failed connections), and drops off 15 minutes after it ends.
  - `routes.js`: `GET /api/live` and `GET /api/live/stream`.
- **Phone setup to test live:** fill the Twilio vars and `ALLOWED_NUMBERS` in `.env`, run `ngrok http 3000`, set `PUBLIC_URL` to the https ngrok URL, `npm run dev`, then open `/phone.html`.

**Part 2 checklist**
- [~] A verified phone rings, the scammer talks, a strike plays the whistle tone, and the ref speaks: the bridge is tested with fakes. Live test pending.
- [~] A fake card number → red-card tone → the unmask → hang-up: tested with fakes. Live test pending.
- [x] `/api/stream` shows live turns and actions during a call (the phone page uses it).
- [x] Hanging up mid-call → `passed`, and both sockets close (tested).
- [x] Unknown `numberId` → 403. Missing Twilio env → 503 `PHONE_DISABLED` (tested).

## How to use it
```bash
cp .env.example .env      # fill OPENAI_API_KEY; model and voice can stay blank (defaults below)
npm run dev
open http://localhost:3000/dev/voice   # headphones on
```
- Defaults when the env is blank: `OPENAI_REALTIME_MODEL=gpt-realtime-2.1` and `OPENAI_REALTIME_VOICE=cedar`. The optional `OPENAI_TRANSCRIBE_MODEL` defaults to `gpt-4o-transcribe`. It isn't in `.env.example`, which is a foundation file, so add it there only if we need to change it.
- **For Agent F:**
  - `start()` calls `onError` **and** rejects with the same `{ code, message }`, so wrap it in `try/catch` and show nothing extra in the catch.
  - Pressing End while connecting resolves `{ callId: null }` with no error.
  - On a reveal, call `client.unmask(action.ref.say)` and fall back to `speechSynthesis` if it resolves `false`. If it's never called, the client closes itself after 15 s.
  - The optional `onDebug` handler isn't part of the contract. Ignore it.

## Acceptance checklist results
**Part 1**
- [ ] `/dev/voice`: 5 response latencies with a median ≤ 1.5 s. **Needs a human with a key, a mic, and headphones.** The page measures it automatically (the "Latency" box). Paste the numbers here.
- [~] Every finished line shows up as a Turn, and `/api/voice/turn` returns actions: verified with fake WebRTC and route tests. Live check pending (try "I'm with TD" after L merges the rules).
- [~] "stop" → a reveal through `onActions`, the mic stops, the unmask speaks, then `onStatus("ended")`: verified with fakes. Live check pending (the dev page's "auto unmask on reveal" box tests the unmask).
- [~] `"scammer_speaking"` / `"live"` follow the scammer's audio: verified with fakes. Live check pending.
- [ ] Speaker test (no headphones): the scammer's voice doesn't come back as victim Turns. **Needs a human.** Tell P1 the result (it decides how loud the music can be).
- [x] No API key in the browser by design: the browser only ever gets the `ek_` client secret (2-minute TTL) with `Cache-Control: no-store`. Still to do: double-check the dev tools Network and Sources tabs live.
- [x] With `OPENAI_API_KEY` blank, the server starts and `/api/voice/session` returns 502 `UPSTREAM_ERROR` (unit test plus a curl against the real `server.js`).
- [x] `src/voice/*.test.js` covers request validation and error shapes, with OpenAI mocked (no network).
- [x] `npm test`: 34 pass (16 foundation plus 18 voice). `npm run check-ownership -- backend` passes once committed (see the change request).

## Known issues
- Not yet run against the live Realtime API from here (no key on this machine). The event names and request shapes follow the Nov 2026 docs, but the first live run is the real test. The live-only risks:
  - the client-secret response field (the code accepts `value`, or the older `client_secret.value`)
  - whether `output_audio_buffer.*` events arrive (if not, the unmask still works, but resolves at the 15 s cap instead of on the stop event)
  - VAD tuning for slow speakers (`silence_duration_ms` 600 in `config.js`)
- Victim transcripts can arrive out of order across speech turns (a documented API behaviour). That's rare and accepted for now.
- `/api/voice/turn` trusts any caller that knows the `callId` (an unguessable UUID). That's fine for a hackathon.

## Requests for other roles
- **Agent L:** keep each scenario's `system_prompt` free of instructions about who speaks first. The client asks the scammer to say `opening_line` itself.
- **Agent F:** see "For Agent F" above.
