# Handoff: frontend

<!-- If you need a foundation change, put a CHANGE REQUEST block here first (SPEC.md §4). -->

## CHANGE REQUEST (SPEC.md): the live board is gone, "Take over call" is in
Done on Nov 13, 2026 at the team's request (P1), across frontend **and** backend files (Agent B's `src/voice/`, `src/phone/`, `public/js/voice-client.js`; see the note in `handoff/backend.md`). The spec still describes the old shape; please update:
- **Remove §5.11** (`GET /api/live`, `GET /api/live/stream`, `DRILL_NOT_FOUND`), the `src/live/` row in the tree, `/live.html` from the pages list, and the "opt-in sharing" bullets (§0, §5.10).
- **§5.5:** `POST /api/voice/session` takes `{ scenarioId }` and returns `{ callId, clientSecret, model, voice, openingLine }` (no `watchId`). `POST /api/phone/start` takes `{ numberId, scenarioId }` and returns `{ callId }`.
- **§5.7:** `start(scenarioId) → Promise<{ callId }>`.
- **New (Part 2):** `WS /phone/takeover?callId=` ("Take over call"). The server answers `{ event: "ready" }`, then relays `{ event: "media", payload }` (base64 μ-law, 8 kHz, 20 ms frames) both ways; the browser sends `{ event: "end" }` to hang up. Close code `4404 NO_LIVE_CALL` if the call isn't live or someone already has the line. The AI session is closed on take-over, nothing more is transcribed (the ref stops scoring), and the drill ends (`endCall` → the reveal on `/api/stream`) when either side hangs up.
- `src/shared/contract.js` line 43 still mentions the live board in a comment.

## Nov 13, 2026: no live board, "Take over call" on the phone page
- **Removed:** `live.html`, `js/live.js`, the "Show on the live board" switches (drill and phone), the "On the live board" badge, the Live tab in every nav (`--count:3`), `api.liveBoard`, and the `shareLive`/`watchId` plumbing in `drill.js`, `voice-client.mock.js` and (Agent B's) `voice-client.js`.
- **Removed earlier the same day:** the grandchild scenario from everything under `public/` (`api.scenarios()` filters `grandkid` out: only unknown-caller scenarios are offered), and the glow on the phone icon.
- **Take over call** (`phone.html`, `js/phone.js`, `js/phone-audio.js`, `js/audio/mulaw-capture.worklet.js`): once the phone is answered (the first transcript line arrives), a card on the stage explains that the person who placed the call can switch it to themselves, with a **Take over call** button. Pressing it asks for the mic, opens `/phone/takeover?callId=`, and on `ready` flips the card to "You're on the call" (status pill `human`, a live-mic indicator, an **End call** button). The mic is averaged down to 8 kHz and μ-law encoded in an AudioWorklet; the phone's frames play through 8 kHz AudioBuffers (the context resamples). The transcript stops at "YOU TOOK OVER THE CALL" and the unmask line isn't shown after a take-over (nobody said it). Errors: `MIC_DENIED`, `NO_LIVE_CALL` (close code 4404), `TAKEOVER_UNSUPPORTED` (no AudioWorklet).
- **Not run here:** no Node on this machine, so `npm test` and the real phone run are still owed. Syntax was checked with JavaScriptCore. Things to try live: echo on the phone side (the mic uses echo cancellation; headphones help), the ~40 ms jitter buffer, and the hang-up order (End → the phone drops → the report card appears).

## Status
Built on top of P1's "Ref Desk" design (`design-concepts/6-ref-desk.html`): the same look, now wired to the real system. **P1: pull `main` before continuing.** The scripted page is now the real drill page.

## UI: WayKin design system (replaces the Liquid Glass look)
- **The template is WayKin** (`~/Hackathon_project/Waykin/frontend/src/styles.css`). It's Apple-style:
  - system fonts, iOS system colours, `#f5f5f7` grouped background, white 18px cards, 0.5px separators
  - a frosted sticky header with a centred title and a segmented nav with a sliding thumb
  - section titles with meta text, list rows with icon tiles, iOS switches
  - one blue pill for the main action (`#0071e3` fill in both themes, as in WayKin) and grey pills for the rest
  - round glass buttons floating on the stage, pure black dark mode
- **Layout:** a 400px side panel (pick a call, settings, the conversation, the Ref's view) next to a stage. The stage plays the part of WayKin's map: a welcome when idle, the call card, then the report. Under 900px it stacks as header → stage → panel.
- **Details:**
  - the conversation uses iMessage-style bubbles (grey for the caller, blue for you)
  - the orb reads its colours from the theme (`--indigo`, `--blue`, `--red`, `--orange`, `--green`)
  - the theme boots from `js/theme-boot.js` (a file, like WayKin's `theme.js`)
  - the web fonts were removed (system fonts only)
- **Kept:** every element ID, view transitions, the step guide, theme and text-size buttons, reduced-motion and reduced-transparency support. AA contrast in both themes (axe: 0 violations).

## UI revamp: "Liquid Glass" (superseded by the WayKin design above)
- **`css/app.css`** replaces `desk.css`. It covers:
  - frosted glass surfaces with specular highlights and a moving rim sheen on the floating nav
  - a drifting colour background with fine grain
  - **light and dark themes** (follows the device, or pick one; remembered)
  - **three text sizes** (round buttons in the nav, `js/ui/prefs.js`)
- **Transitions** (View Transitions API, Chrome, Edge and Safari 18):
  - pages cross-fade with a slight blur
  - the start card morphs into the call card, then into the declined or report state
  - themes switch with a circular wipe from the button
  - bubbles spring in, strikes slam on with a red edge flash (green for good moves), the unmask flips the card, and the report sections stagger in
- **Easier to follow:** a 4-step guide (Pick a call → Answer → Talk → See how you did), plain button labels, a "required" marker on the practice-call checkbox, and a skip link on every page.
- **Accessibility:**
  - `prefers-reduced-transparency` / `prefers-contrast: more` → solid surfaces
  - `prefers-reduced-motion` → no animation
  - light-theme colours tuned for AA contrast
  - axe: 0 violations on every page
- **Removed on purpose:** an SVG "refraction" backdrop filter. Some Chromium builds accept `backdrop-filter: url()` but then render no blur at all.

## What I built
- `css/desk.css`: P1's design system extracted and shared by every page, with self-hosted fonts in `fonts/` (OFL licences included, no CDN).
- `index.html` + `js/drill.js`: choose → ringing (ringtone) → Decline (celebrated, no call) or Answer → live → the unmask (the card flips, a caption, the scammer voice) → the report card. It uses the real `voice-client.js`. `?mock=1` / `?mock=pass` (or the "Play the demo call instead" button on any voice error) uses `voice-client.mock.js`. `?judge=1` opens the Ref's view.
- `js/voice-client.mock.js` + `fixtures/mock-*.json`: scripts generated from the **real** pipeline (`node public/fixtures/generate.mjs`), so every action matches the live shape.
- `js/ref-player.js`: per the role file, and the reveal tries `client.unmask()` first.
- `js/audio/`: `engine.js` (one AudioContext, sound and music toggles remembered), `sfx.js` (whistle, red card, chime, fanfare, ringtone), `score.js` (the adaptive tension score), and `replay.js` ("Replay your drill").
- `js/ui/`: `orb.js` (P1's orb, now also reacting to the music), `feed.js` (the conversation, the Ref's view, the strike meter), `toast.js`.
- `report.html` + `js/report.js` + `js/report-view.js`: the report card (sessionStorage or `?fixture=`), Replay, and a print stylesheet.
- `phone.html` + `js/phone.js`: the phone drill dashboard, with the "not set up" state on 503.

## How to use it
`npm run dev` → `/` (drill), `/?mock=1&judge=1` (demo with no mic and no key), `/phone.html`, `/report.html?fixture=failed-strikes`.

## Acceptance checklist results
Headless Chrome run (fake mic, OpenAI blocked): 22/22 checks.
- [x] The mock fail script plays end to end: strikes, the Ref's view, the unmask bubble, a red card report. The transcript shows no digits, and spoken numbers show as • • • •
- [x] A real client with OpenAI unreachable shows a friendly error, and "Play the demo call" falls back
- [x] Decline → the celebration panel, with no session request
- [x] `report.html?fixture=…` renders, Replay highlights the events, and the empty state works
- [x] `/phone.html` shows "not set up" on `PHONE_DISABLED`
- [x] ~~The live board~~ (removed Nov 13, 2026)
- [ ] "Take over call" on a real phone drill: mic → phone, phone → browser, End hangs up and the report card appears (needs Twilio, ngrok and a phone)
- [x] No console errors on any page. axe (WCAG 2.1 AA plus best practice): **0 violations** on index (picker and report), report, and phone (checked before the take-over card was added)
- [x] No horizontal scroll at 375 px
- [ ] Not checked by machine: how the sounds and music actually sound, the speechSynthesis voices, and the real-mic run (needs a human with headphones)

## Known issues
- The tension score plays through the speakers. Run the mic-bleed test at sync 2 (BACKEND.md) and lower the music if needed. The Music toggle is on the drill page.
- `public/fixtures/generate.mjs` lives in `public/` (so it's served). It's harmless, but it could move to `scripts/` with a foundation change.

## Requests for other roles
