# Role F: Frontend (Agent F)

**Person:** P1 · **Branch:** `role/frontend` · **Commit prefix:** `[F]`

## Mission
Every page the user sees, and playing the ref's sounds and voice. It should feel calm, kind, and very accessible, since the real users are seniors.

You are also the team's entry for **Best Looking Project** and **Best Inclusion of Music**, and you carry most of the main track's **Polish** score (SPEC §0). **Order of work:** (1) the core pages work end to end on the mock, (2) the visual design system, the incoming-call screen, and the Ref's view (sync 3), (3) music and sound (sync 4). Never let 2 or 3 break 1.

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
│   ├── audio/
│   │   ├── engine.js        one shared AudioContext, master gain, music on/off
│   │   ├── sfx.js           whistle, red-card sting, chime, fanfare (synthesized)
│   │   ├── score.js         adaptive tension score for the live drill
│   │   └── replay.js        "Replay your drill" sonification for the report
│   └── ui/
│       ├── strike-lights.js
│       ├── event-feed.js
│       ├── refs-view.js     the "Ref's view" panel (SPEC §0.3)
│       ├── incoming-call.js ringing call screen shown before the drill goes live
│       ├── visualizer.js    canvas visualizer fed by the score's AnalyserNode
│       └── toast.js
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
States: **choose → ringing → connecting → live → unmasking → ended**, plus **declined**. Build the core flow first with a plain "Answer" button standing in for the ringing screen, then make it the full incoming-call screen in the visual pass.
1. **Choose:** load `GET /api/scenarios` and show cards (title + blurb). A big "Start drill" button. A checkbox the user must tick: "I understand this is a practice scam call." Start → **ringing**.
2. **Ringing:** the incoming-call screen (see Visual design) with **Answer** and **Decline**.
   - **Decline** → the **declined** state: a celebration panel ("Not answering unknown numbers is a great habit. Real scammers count on you picking up.") with "Answer this time" (back to ringing) and "Pick another drill". No call is created and nothing goes to the network.
3. **On Answer** (inside the click handler, for mic and audio permission): import the voice client.
   - Default: `import("/js/voice-client.js")`
   - If the URL has `?mock=1`, or the real module fails to load: `import("/js/voice-client.mock.js")` and show a small "Demo mode" badge
   - `client = createVoiceClient({ onStatus, onTurn, onActions, onError })`, then `await client.start(scenarioId)`
4. **Live view:** status text ("Connecting…", "On the call", "Caller is talking", "Ref is speaking"), the call timer, strike lights (3), an event feed (the newest event on top), the Ref's view, a big "End drill" button (→ `client.end()`), and a hint: "Say 'stop' anytime to end." `onStatus("scammer_speaking")` animates the caller avatar and ducks the music. It's best-effort, so never wait on it.
5. **`onActions(actions)`:** process them **in order, one at a time** (await each):
   - `strike_called` → `strikeLights.set(n)`, add it to the feed, `await refPlayer.play(action, client)`
   - `warning_shown` → feed + toast (no sound)
   - `credit_shown` → feed + toast + `refPlayer.play` (chime)
   - `reveal` → **unmasking** state (the reveal flip, see Visual design) → `await refPlayer.play(action, client)`, save `sessionStorage["scamDrill.result"] = JSON.stringify(action)`, go to `/report.html`
6. **`onError`:** a friendly message with a "Try again" button. Never show raw error text or stack traces.

### `ref-player.js`
```js
export async function play(action, client)  // resolves when the ref is done
```
1. If `action.ref.sound` is set: `client.pauseScammer()`, `client.setRefSpeaking(true)`, then play that sound by name (`whistle`, `red_card`, `chime`, `fanfare`) through `audio/sfx.js`. Until the music pass, a simple oscillator plus gain envelope (about 400 ms) per name is enough. Ignore unknown names.
2. If `action.ref.say` is set and the action is a **`reveal`**: this is the unmask. `const ok = await client.unmask(say)`. If `ok` is false (the mock, or a voice failure), fall back to `speechSynthesis` as below. Show the line as a caption on the reveal card either way.
3. If `action.ref.say` is set for any other action: speak it with `speechSynthesis`. Pick a voice **different from** the scammer's (prefer an English voice whose name includes "Google" or "Samantha", otherwise the first `en-` voice). Rate 0.95. Wait for `onend`, with a timeout fallback of `say.length * 80 ms`.
4. Then `client.setRefSpeaking(false)` and, unless the action is `reveal`, `client.resumeScammer()`.
5. Never throw. If speech isn't available, show the text as a toast instead.

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
It respects `pauseScammer`, `setRefSpeaking`, and `end()` (`end` emits a `passed` reveal if the call is still live). It emits `"scammer_speaking"` for about 2 s on each scammer turn, then `"live"`. `unmask()` resolves `false` immediately, so the ref-player's `speechSynthesis` fallback gets exercised. Build the WireActions in these fixtures from `test/fixtures/reveal-*.json` so the shapes match exactly. That includes `ref.sound` values from the new set and at least one event with `downgraded`, so the Ref's view has something to show.

## Design and accessibility requirements
- Base font 18px, line-height 1.6, max content width about 720px, big tap targets (48px minimum)
- WCAG 2.2 AA contrast, nothing conveyed by color alone, visible focus outlines
- Semantic landmarks (`header`, `main`, `nav`), one `h1` per page, labelled form controls
- Live updates go through an `aria-live="polite"` region; strikes use `aria-live="assertive"`
- Everything works by keyboard alone, at 200% zoom, and with `prefers-reduced-motion`
- Plain language, no jargon, never shaming
- Respect dark mode with `prefers-color-scheme`

## Visual design (Best Looking Project, after the mock demo works)
Beautiful and accessible aren't in tension here: big type and strong contrast *are* the look.
- **Concept: the referee.** It should feel like a calm, trustworthy official. Strike lights read like a scoreboard, a whistle icon marks strikes, a red card marks an autofail, and a green flag marks credit. Use inline SVG icons that you draw yourself (no icon CDN).
- **Design tokens in `base.css`:** a neutral background, one confident accent, and semantic colors for warning, strike, autofail, and good defense, each with a text label and an icon so color is never the only signal. Plan both the light and dark palettes; don't auto-invert. Use a system font stack, or self-hosted font files in `public/fonts/` only if the licence allows it. Use a type scale with clear hierarchy: one big display size for the drill state.
- **The incoming-call screen (`ui/incoming-call.js`):** after Start, show a full-screen phone-style ringing card: the caller label "Unknown caller" with the scenario title underneath, a pulsing ring, a synthesized ringtone (through `audio/engine.js`, which respects the Music toggle; a ringtone can't autoplay, but the Start click unlocks audio), and big **Answer** and **Decline** buttons. **Answer** is the click that calls `client.start()`, so the mic and audio permissions still come from a user gesture. **Decline** goes to the celebrated declined state (see the drill page spec). It's not a report card, because no call exists.
- **The live call screen:** the call timer, the scenario's caller label, the strike scoreboard, the visualizer, the event feed, and the Ref's view panel.
- **The reveal moment (the unmask):** this is the signature visual. The caller card flips (or cross-fades) from "Unknown caller" to a "This was a Loki drill" card in the accent color while the scammer's own voice drops the act, with the line shown as a caption. It should feel like the mask coming off.
- **Motion:** strike lights "slam" on with a small scale and shake, toasts slide in, report cards stagger in. Keep it to 150–400 ms and ease-out. Under `prefers-reduced-motion`, switch to plain fades or nothing.
- **The report card** should look good enough to print and stick on the fridge: a big outcome badge, a clean timeline, and the takeaway in a callout. The print stylesheet should give one tidy page.
- **The Ref's view panel (`ui/refs-view.js`, SPEC §0.3):** a `<details>` element, open by default when the URL has `?judge=1` (the demo) and closed otherwise. It shows each event's tier, type, quote, a source badge ("Rules" or "AI judge"), and confidence as a percentage, and, when `event.downgraded` is set, the reason in plain words (`low_confidence` → "AI wasn't sure enough to call a strike", `repeat_type` → "Already called"). This is where judges see the complexity, so make it look like a pro tool: monospace numbers and tidy alignment.
- **Landing page:** a hero with the tagline, a 3-step "How it works" with icons, and one clear call to action. It's the first screenshot on Devpost.

## Music and sound (Best Inclusion of Music, after the visual pass)
Everything uses the Web Audio API: no audio files, no libraries, no new dependencies. It's driven only by the `WireAction`s and voice-client statuses you already receive.
- **`audio/engine.js`:** one lazily created `AudioContext`, resumed inside the Answer click (autoplay policy). It has a master gain, a music bus, and an sfx bus. **Music on/off** is a visible toggle on the drill and report pages, stored in `localStorage["scamDrill.music"]` (default on). If Web Audio is missing, everything no-ops silently.
- **`audio/sfx.js`, the ref's sound identity:** one function per `RefScript.sound` name (Agent L's ref picks which one). `whistle` is a two-tone referee whistle with a little pitch wobble, `red_card` is a short low sting, `chime` is a bright two-note chime, and `fanfare` is a 2-second victory fanfare (an arpeggiated major chord). Keep each one under 2 s. Plus `ring()` for the incoming-call screen.
- **`audio/score.js`, the adaptive tension score:** a quiet generative loop while the call is `live`. Layer 0 (0 strikes) is a soft pad at about 70 BPM. Each strike adds a layer: strike 1 adds a heartbeat pulse, strike 2 raises the tempo and shifts to minor, strike 3 is never heard because the reveal comes first. A `warning_shown` adds a brief swell, and `good_defense` resolves to a major chord for a few bars. **Duck the music to about 10%** while the status is `scammer_speaking` or `refPlayer` is playing, and keep it low overall (it must never fight the scammer's voice). On `reveal`: a hard stop, then the sfx.
- **Mic bleed:** music played through speakers can leak into the mic and get transcribed. Test it at sync 2 against the real voice client. If it does leak, keep the score at headphone-safe levels and add the note "Music plays best with headphones". The toggle is your escape hatch.
- **`ui/visualizer.js`:** a `<canvas>` fed by an `AnalyserNode` on the music bus, styled to match (bars or a ring around the caller avatar). It's decorative, so give it `aria-hidden="true"`, and draw a static frame under `prefers-reduced-motion`.
- **`audio/replay.js`, "Replay your drill" on the report card:** turns the `events` timeline into a melody of about 10 s. Time maps from `t` (scaled to fit), `good_defense` notes step up a major scale, `warning` notes hold a neutral tone, `strike` notes step down, and an autofail ends on a low sting. As each note plays, its event card gets a highlight (an `aria-current` style plus a visible outline). It needs a Play/Stop button and must never autoplay.

## What you depend on, and how to work without it
| Dependency | Until it exists, use |
|---|---|
| `public/js/voice-client.js` (B) | `voice-client.mock.js` via `?mock=1` |
| Voice and phone endpoints (B) | Mock client, fixtures, and showing the `PHONE_DISABLED` state |
| Real scenarios and ref lines (L) | The stub CRA scenario and stub ref lines are already served |

Run the real server the whole time: `npm run dev` → http://localhost:3000.

## Acceptance checklist (paste results into `handoff/frontend.md`)
- [ ] `/drill.html?mock=1`: the full fail script plays (strikes light up, the whistle and ref voice fire, the unmask falls back to speechSynthesis with a caption, and the reveal goes to the report)
- [ ] `/drill.html?mock=pass`: ends on a passed report card
- [ ] `/report.html?fixture=passed`, `failed-strikes`, and `failed-autofail` all render correctly. With no data, it shows the empty state
- [ ] `/phone.html` shows the "not set up" state when the backend returns `PHONE_DISABLED`
- [ ] Keyboard-only run through drill → report works
- [ ] Lighthouse accessibility ≥ 95 on index, drill, and report (record the scores)
- [ ] No console errors on any page
- [ ] Incoming-call screen: the ringtone plays, Answer starts the drill, and Decline shows the celebration panel with no network request
- [ ] `/drill.html?mock=1&judge=1`: the Ref's view shows the source and confidence for every event, and the downgrade reason where there is one
- [ ] The reveal flip plays, and with reduced motion it's a plain fade
- [ ] Whistle, red-card sting, chime, and fanfare each play at the right moment on the mock
- [ ] The tension score adds a layer per strike, ducks under the scammer (`scammer_speaking`) and the ref, and stops on the reveal. The Music toggle silences everything and is remembered
- [ ] "Replay your drill" plays on all 3 report fixtures and highlights each event in time
- [ ] Mic bleed tested with the real voice client on a speaker (write the result in the handoff)
- [ ] Light and dark screenshots of all 4 pages saved for Devpost (SPEC §10)
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
drill.html so the mock demo works first. Then do the visual design section, then
music and sound, in that order, committing after each. Only edit paths you own.
Finish by running the acceptance checklist and updating handoff/frontend.md.
```
