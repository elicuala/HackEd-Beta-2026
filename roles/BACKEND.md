# Role B: Backend and voice (Agent B)

**Person:** P2 (also the default merger for `main`) · **Branch:** `role/backend` · **Commit prefix:** `[B]`

## Mission
Make the AI scammer talk, fast. Browser voice first (the critical path), then real phone calls (stretch). You turn speech into `Turn`s and hand them to the foundation. You never implement game rules.

## You own
- `src/voice/**`
- `src/phone/**`
- `public/js/voice-client.js` (the only file in `public/` you may touch)
- `handoff/backend.md`

## You must not touch
`src/core/`, `src/shared/`, `src/rules/`, `src/judge/`, `src/scenarios/`, `src/ref/`, `server.js`, `package.json`, or any other file in `public/`.

## How your code plugs in
- Create `src/voice/routes.js` and `src/phone/routes.js`, each with `export default function register(app)`. For WebSockets, also add `export function attach(server)`. `server.js` loads them automatically.
- Run calls **only** through `src/core/calls.js`: `createCall`, `processTurn`, `endCall`, `getCall` (SPEC §5.4). That gives you rules, judge, ref scripts, and live SSE for free.
- Get scenario prompts from `getScenario(id)` in `src/scenarios/index.js` (a stub CRA scenario exists now, and L adds more).
- Validate every request body. Send errors in the SPEC §5.5 shape. Wrap OpenAI and Twilio failures as `UPSTREAM_ERROR` (502). Log only error codes, never bodies.

## Part 1: Browser voice (do this first, due at sync 1, hour 6)

### Server: `src/voice/routes.js` (+ helpers in `src/voice/`)
| Endpoint | Behavior |
|---|---|
| `POST /api/voice/session { scenarioId }` | `createCall({ scenarioId, channel: "browser" })`. Mint a Realtime **client secret** server-side with your `OPENAI_API_KEY`, with the session configured with `instructions = scenario.system_prompt`, the voice from `OPENAI_REALTIME_VOICE`, the model from `OPENAI_REALTIME_MODEL`, and **input audio transcription turned on**. Return `{ callId, clientSecret, model, voice, openingLine: scenario.opening_line }`. Bad scenario → 404 `SCENARIO_NOT_FOUND`. |
| `POST /api/voice/turn { callId, turn }` | Validate `turn` (`validateTurn`), then `actions = await processTurn(callId, turn)`, then `{ actions }` |
| `POST /api/voice/end { callId }` | `{ actions: await endCall(callId) }` |

Use the `openai` SDK or plain `fetch` to the client secrets endpoint. **Read the current Realtime WebRTC guide first.** Model IDs, endpoint paths, and event names change, so don't rely on memory.

### Browser: `public/js/voice-client.js`
Implements SPEC §5.7 exactly. Agent F's UI imports it and expects identical behavior to their mock.
1. `start(scenarioId)`: `POST /api/voice/session` → `getUserMedia({ audio: true })` → `RTCPeerConnection` with the mic track, an off-DOM `new Audio()` for the remote track, and a data channel for events → SDP offer posted to the Realtime calls endpoint with the client secret → set the answer. `onStatus("connecting")`, then `"live"`.
2. Make the scammer speak the `openingLine` first (send a response request over the data channel).
3. Listen on the data channel for **finished** transcripts:
   - the model's own output transcript → `Turn { speaker: "scammer" }`
   - the input audio transcription → `Turn { speaker: "victim" }` (**drop it while `setRefSpeaking(true)`**)
   - `t` = seconds since `start()` resolved
   - POST each Turn to `/api/voice/turn`, call `onTurn(redactedTurn)`, then `onActions(actions)`. Post turns **one at a time in order** (a promise queue).
4. `pauseScammer()`: mute the audio element, cancel any in-progress response. `resumeScammer()`: unmute.
5. `end()`: `POST /api/voice/end` → `onActions`.
6. On a `reveal` action: close the peer connection, stop mic tracks, `onStatus("ended")`.
7. Any failure → `onError({ code, message })`, using codes `MIC_DENIED`, `SESSION_FAILED`, `CONNECTION_LOST`, `UPSTREAM_ERROR`.

Build a private test page for yourself **inside your folder**, `src/voice/dev.html`, served by your routes at `GET /dev/voice`. Don't create pages in `public/`.

## Part 2: Phone calls (stretch, only after sync 2 says go)

### `src/phone/routes.js` (+ `src/phone/bridge.js`)
| Endpoint | Behavior |
|---|---|
| `GET /api/phone/numbers` | Parse `ALLOWED_NUMBERS`. Return `[{ id: "n1", label: "•••• 1234" }]`. If any Twilio env var is missing → 503 `PHONE_DISABLED`. |
| `POST /api/phone/start { numberId, scenarioId }` | Map `numberId` → number (403 `NUMBER_NOT_ALLOWED` if unknown). `createCall({ channel: "phone" })`. Place an outbound call with the `twilio` SDK, from `TWILIO_FROM_NUMBER`, with its URL set to `${PUBLIC_URL}/twilio/voice?callId=…`. Return `{ callId }`. |
| `POST /twilio/voice` | Return TwiML `<Connect><Stream url="wss://…/twilio/stream?callId=…"/></Connect>`. Validate the Twilio signature with `twilio.validateRequest`. |
| `WS /twilio/stream` | In `attach(server)`: a `ws` server with `noServer: true`, handling `upgrade` only for `/twilio/stream`. Bridge it to a Realtime **WebSocket** session configured for **G.711 μ-law** audio in and out (Twilio's native format, so no conversion). |

Bridge behavior:
- Finished transcripts → `processTurn` (the same Turn rules as the browser)
- `strike_called` → play a short beep (generate μ-law tone frames yourself) then have the model say `action.ref.say` prefixed with "Referee:". Drop victim transcripts while the ref is speaking.
- `reveal` → say the reveal line, wait for playback to finish, hang up with the Twilio REST API
- The victim hangs up (Twilio `stop` event or a socket close) → `endCall(callId)`
- Clean up both sockets on every exit path

## Acceptance checklist (paste results into `handoff/backend.md`)
**Part 1**
- [ ] `/dev/voice`: talk to the CRA scammer with headphones. Record 5 response latencies (end of your speech → first scammer audio). Target: median ≤ 1.5 s
- [ ] Every finished line shows up as a Turn, and `/api/voice/turn` returns actions (try "I'm with TD" after L merges rules)
- [ ] Saying "stop" → a reveal comes through `onActions`, audio and mic stop, `onStatus("ended")`
- [ ] No API key in browser dev tools (Network tab and Sources)
- [ ] With `OPENAI_API_KEY` blank, the server still starts, and `/api/voice/session` returns 502 `UPSTREAM_ERROR`
- [ ] `src/voice/*.test.js` covers request validation and error shapes, with OpenAI mocked (no network)

**Part 2 (stretch)**
- [ ] A verified phone rings, the scammer talks, and a strike beeps and the ref speaks
- [ ] A fake card number → reveal → the call hangs up
- [ ] `/api/stream` shows the live turns and actions during the call
- [ ] Hanging up mid-call cleans everything up (no errors in the log)
- [ ] An unknown `numberId` → 403. Missing Twilio env → 503 `PHONE_DISABLED`

- [ ] `npm test` and `npm run check-ownership -- backend` pass

## References
- OpenAI Realtime API with WebRTC (client secrets, SDP flow): https://developers.openai.com/api/docs/guides/realtime-webrtc
- OpenAI create client secret (API reference): https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
- OpenAI Realtime docs hub (event names, transcription, WebSocket): https://developers.openai.com/api/docs/guides/realtime
- Twilio Media Streams: https://www.twilio.com/docs/voice/media-streams
- Twilio + OpenAI Realtime reference app (Node): https://github.com/twilio-samples/speech-assistant-openai-realtime-api-node
- Twilio tutorial for the above: https://www.twilio.com/en-us/blog/voice-ai-assistant-openai-realtime-api-node
- OpenAI's own Realtime + Twilio demo: https://github.com/openai/openai-realtime-twilio-demo
- Twilio outbound calls (Node): https://www.twilio.com/docs/voice/make-calls
- Twilio webhook signature validation: https://www.twilio.com/docs/usage/webhooks/webhooks-security
- `ws` library (noServer + upgrade): https://github.com/websockets/ws
- Express 5 routing and errors: https://expressjs.com/en/guide/routing.html
- MDN `RTCPeerConnection`: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection
- MDN `RTCDataChannel`: https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel
- ngrok quickstart: https://ngrok.com/docs/getting-started/

## Launch prompt
```
You are Agent B (Backend and voice). Read CLAUDE.md, SPEC.md, and roles/BACKEND.md.
Do Part 1 only (browser voice). Before writing Realtime code, read the current
OpenAI Realtime WebRTC guide from the references. Only edit paths you own. Finish
by running the Part 1 acceptance checklist and updating handoff/backend.md.
Do not start Part 2 until your human says go.
```
