# Handoff: frontend

<!-- If you need a foundation change, put a CHANGE REQUEST block here first (SPEC.md §4). -->

## Status
Built on top of P1's "Ref Desk" design (`design-concepts/6-ref-desk.html`): the same look, now wired to the real system. **P1: pull `main` before continuing.** The scripted page is now the real drill page.

## What I built
- `css/desk.css`: P1's design system extracted and shared by every page, with self-hosted fonts in `fonts/` (OFL licences included, no CDN).
- `index.html` + `js/drill.js`: choose → ringing (ringtone) → Decline (celebrated, no call) or Answer → live → the unmask (the card flips, a caption, the scammer voice) → the report card. It uses the real `voice-client.js`. `?mock=1` / `?mock=pass` (or the "Play the demo call instead" button on any voice error) uses `voice-client.mock.js`. `?judge=1` opens the Ref's view.
- `js/voice-client.mock.js` + `fixtures/mock-*.json`: scripts generated from the **real** pipeline (`node public/fixtures/generate.mjs`), so every action matches the live shape.
- `js/ref-player.js`: per the role file, and the reveal tries `client.unmask()` first.
- `js/audio/`: `engine.js` (one AudioContext, sound and music toggles remembered), `sfx.js` (whistle, red card, chime, fanfare, ringtone), `score.js` (the adaptive tension score), and `replay.js` ("Replay your drill").
- `js/ui/`: `orb.js` (P1's orb, now also reacting to the music), `feed.js` (the conversation, the Ref's view, the strike meter), `toast.js`.
- `report.html` + `js/report.js` + `js/report-view.js`: the report card (sessionStorage or `?fixture=`), Replay, and a print stylesheet.
- `phone.html` + `js/phone.js`: the phone drill dashboard, with the "not set up" state on 503.
- `live.html` + `js/live.js`: **the live board**. It lists shared drills (polled every 3 s) and streams the selected one over SSE, with "Follow new drills" on.

## How to use it
`npm run dev` → `/` (drill), `/?mock=1&judge=1` (demo with no mic and no key), `/live.html`, `/phone.html`, `/report.html?fixture=failed-strikes`.

## Acceptance checklist results
Headless Chrome run (fake mic, OpenAI blocked): 22/22 checks.
- [x] The mock fail script plays end to end: strikes, the Ref's view, the unmask bubble, a red card report. The transcript shows no digits, and spoken numbers show as • • • •
- [x] A real client with OpenAI unreachable shows a friendly error, and "Play the demo call" falls back
- [x] Decline → the celebration panel, with no session request
- [x] `report.html?fixture=…` renders, Replay highlights the events, and the empty state works
- [x] `/phone.html` shows "not set up" on `PHONE_DISABLED`
- [x] The live board: a shared drill appears once it starts, an unshared one never does, lines, strikes, the red card, and the unmask stream live, and the `callId` never reaches the page
- [x] No console errors on any page. axe (WCAG 2.1 AA plus best practice): **0 violations** on index (picker and report), report, phone, and live
- [x] No horizontal scroll at 375 px
- [ ] Not checked by machine: how the sounds and music actually sound, the speechSynthesis voices, and the real-mic run (needs a human with headphones)

## Known issues
- The tension score plays through the speakers. Run the mic-bleed test at sync 2 (BACKEND.md) and lower the music if needed. The Music toggle is on the drill page.
- `public/fixtures/generate.mjs` lives in `public/` (so it's served). It's harmless, but it could move to `scripts/` with a foundation change.

## Requests for other roles
