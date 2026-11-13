# Role F: Frontend (Agent F)

**Person:** P1 · **Branch:** `role/frontend` · **Commit prefix:** `[F]`

## Mission
Every page the user sees, and playing the ref's sounds and voice. It should feel calm, kind, and very accessible, since the real users are seniors.

## You own
- `public/**` **except** `public/js/voice-client.js` (that file is Agent B's, so don't create or edit it)
- `handoff/frontend.md`

## You must not touch
Anything in `src/`, `server.js`, `package.json`, `test/`, `scripts/`, or `public/js/voice-client.js`.

## Files to create (exact paths)

```
public/
├── index.html               landing page
├── drill.html               scenario picker + live drill
├── report.html              report card
├── phone.html               phone drill dashboard (stretch, build the UI anyway)
├── css/
│   ├── base.css             tokens (colors, spacing, type), reset, shared components
│   ├── drill.css
│   ├── report.css
│   └── phone.css
├── js/
│   ├── api.js               fetch wrappers for every endpoint in SPEC §5.5 + error handling
│   ├── drill.js             drill page controller
│   ├── report.js            report page controller
│   ├── phone.js             phone dashboard controller (EventSource on /api/stream)
│   ├── ref-player.js        plays WireAction.ref (sound + speech), see below
│   ├── voice-client.mock.js identical interface to SPEC §5.7, scripted fake call
│   └── ui/
│       ├── strike-lights.js
│       ├── event-feed.js
│       └── toast.js
├── sounds/                  (optional) buzzer/chime files, only royalty-free or self-made
└── fixtures/
    ├── mock-call-fail.json  script for the mock voice client (see below)
    ├── mock-call-pass.json
    └── reveal-*.json        copies of test/fixtures/reveal-*.json (you own these copies)
```

All scripts are ES modules: `<script type="module" src="/js/drill.js">`. No frameworks, no CDNs, no build step.

## Page specs

### `index.html`
Headline, one-sentence pitch, "Start a practice drill" → `/drill.html`, a smaller "Phone drill" link → `/phone.html`, and a short "How it works" (3 steps). A consent note: "Drills are practice. Nothing you say is saved."

### `drill.html` + `drill.js`
States: **choose → connecting → live → ended**.
1. **Choose:** load `GET /api/scenarios` and show cards (title + blurb). A big "Start drill" button. A checkbox the user must tick: "I understand this is a practice scam call."
2. **On Start** (inside the click handler): import the voice client.
   - Default: `import("/js/voice-client.js")`
   - If the URL has `?mock=1`, or the real module fails to load: `import("/js/voice-client.mock.js")` and show a small "Demo mode" badge
   - `client = createVoiceClient({ onStatus, onTurn, onActions, onError })`, then `await client.start(scenarioId)`
3. **Live view:** status text ("Connecting…", "On the call", "Ref is speaking"), strike lights (3), an event feed (the newest event on top), a big "End drill" button (→ `client.end()`), and a hint: "Say 'stop' anytime to end."
4. **`onActions(actions)`:** process them **in order, one at a time** (await each):
   - `strike_called` → `strikeLights.set(n)`, add it to the feed, `await refPlayer.play(action, client)`
   - `warning_shown` → feed + toast (no sound)
   - `credit_shown` → feed + toast + `refPlayer.play` (chime)
   - `reveal` → `await refPlayer.play(action, client)`, save `sessionStorage["scamDrill.result"] = JSON.stringify(action)`, go to `/report.html`
5. **`onError`:** a friendly message with a "Try again" button. Never show raw error text or stack traces.

### `ref-player.js`
```js
export async function play(action, client)  // resolves when the ref is done
```
1. If `action.ref.sound` is set: `client.pauseScammer()`, `client.setRefSpeaking(true)`, then play the sound. Generate buzzer and chime with the **Web Audio API** (an oscillator plus a gain envelope, about 400 ms) so no files are needed.
2. If `action.ref.say` is set: speak it with `speechSynthesis`. Pick a voice **different from** the scammer's (prefer an English voice whose name includes "Google" or "Samantha", otherwise the first `en-` voice). Rate 0.95. Wait for `onend`, with a timeout fallback of `say.length * 80 ms`.
3. Then `client.setRefSpeaking(false)` and, unless the action is `reveal`, `client.resumeScammer()`.
4. Never throw. If speech isn't available, show the text as a toast instead.

### `report.html` + `report.js`
Data: `sessionStorage["scamDrill.result"]`, or `?fixture=passed|failed-strikes|failed-autofail` → `/fixtures/reveal-<name>.json`. With no data: "No drill yet" + a button to `/drill.html`.
1. Headline: passed → "You passed the {scenarioTitle} drill." Failed → "Not this time, and that's exactly what practice is for."
2. Strike lights with text ("2 of 3 strikes")
3. Timeline: one card per event: a tier badge (text, not just color), a plain-language name for `type` (a lookup table in `report.js`, falling back to the type with underscores turned into spaces), the quote in quotation marks, and the time as m:ss
4. "What you did well": the `good_defense` events, or "You stayed on the line long enough to learn something. That counts."
5. One takeaway habit, keyed by the most common tactic or type (lookup table). Default: "When in doubt, hang up and call the number on the back of your card or the official website."
6. Buttons: "Try another drill" → `/drill.html`, "Print" → `window.print()` (with a print stylesheet)

### `phone.html` + `phone.js` (stretch backend, but build the UI)
Number dropdown from `GET /api/phone/numbers`, scenario dropdown, consent checkbox, and a "Call" button → `POST /api/phone/start` → `new EventSource("/api/stream?callId=…")`. Render `status`, `turn` (a live redacted transcript), and `action` (the same feed and strike lights as the drill page). The dashboard doesn't play ref audio; it happens on the phone. On `reveal`: save `scamDrill.result` and show a "View report card" link. If `/api/phone/numbers` returns `PHONE_DISABLED`: show "Phone drills aren't set up" and hide the form.

### `voice-client.mock.js`
Same exports and behavior rules as SPEC §5.7. It reads `/fixtures/mock-call-fail.json` (or `-pass` if `?mock=pass`):
```json
[
  { "delayMs": 800,  "kind": "status",  "data": "live" },
  { "delayMs": 1500, "kind": "turn",    "data": { "speaker": "scammer", "text": "Hello, this is…", "t": 0 } },
  { "delayMs": 2500, "kind": "actions", "data": [ /* WireAction objects */ ] }
]
```
It respects `pauseScammer`, `setRefSpeaking`, and `end()` (`end` emits a `passed` reveal if the call is still live). Build the WireActions in these fixtures from `test/fixtures/reveal-failed-autofail.json` so the shapes match exactly.

## Design and accessibility requirements
- Base font 18px, line-height 1.6, max content width about 720px, big tap targets (48px minimum)
- WCAG 2.2 AA contrast, nothing conveyed by color alone, visible focus outlines
- Semantic landmarks (`header`, `main`, `nav`), one `h1` per page, labelled form controls
- Live updates go through an `aria-live="polite"` region; strikes use `aria-live="assertive"`
- Everything works by keyboard alone, at 200% zoom, and with `prefers-reduced-motion`
- Plain language, no jargon, never shaming
- Respect dark mode with `prefers-color-scheme`

## What you depend on, and how to work without it
| Dependency | Until it exists, use |
|---|---|
| `public/js/voice-client.js` (B) | `voice-client.mock.js` via `?mock=1` |
| Voice and phone endpoints (B) | Mock client, fixtures, and showing the `PHONE_DISABLED` state |
| Real scenarios and ref lines (L) | The stub CRA scenario and stub ref lines are already served |

Run the real server the whole time: `npm run dev` → http://localhost:3000.

## Acceptance checklist (paste results into `handoff/frontend.md`)
- [ ] `/drill.html?mock=1`: the full fail script plays (strikes light up, buzzer and ref voice fire, the reveal goes to the report)
- [ ] `/drill.html?mock=pass`: ends on a passed report card
- [ ] `/report.html?fixture=passed`, `failed-strikes`, and `failed-autofail` all render correctly. With no data, it shows the empty state
- [ ] `/phone.html` shows the "not set up" state when the backend returns `PHONE_DISABLED`
- [ ] Keyboard-only run through drill → report works
- [ ] Lighthouse accessibility ≥ 95 on index, drill, and report (record the scores)
- [ ] No console errors on any page
- [ ] `npm test` and `npm run check-ownership -- frontend` pass

## References
- MDN `getUserMedia`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- MDN Web Audio API (oscillators, gain): https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- MDN Web Speech API, `speechSynthesis`: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis
- MDN `EventSource` (Server-Sent Events): https://developer.mozilla.org/en-US/docs/Web/API/EventSource
- MDN `sessionStorage`: https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage
- MDN dynamic `import()`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import
- MDN ARIA live regions: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions
- WCAG 2.2 quick reference: https://www.w3.org/WAI/WCAG22/quickref/
- Chrome autoplay policy (why audio must start in a click): https://developer.chrome.com/blog/autoplay
- Lighthouse accessibility audits: https://developer.chrome.com/docs/lighthouse/accessibility/scoring

## Launch prompt
```
You are Agent F (Frontend). Read CLAUDE.md, SPEC.md, and roles/FRONTEND.md.
Build everything in roles/FRONTEND.md, starting with voice-client.mock.js and
drill.html so the mock demo works first. Only edit paths you own. Finish by
running the acceptance checklist and updating handoff/frontend.md.
```
