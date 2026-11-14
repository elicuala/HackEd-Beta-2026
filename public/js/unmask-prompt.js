// The instructions that make the caller's voice read the unmask line at the end of a drill.
// Shared by the browser voice client and the phone bridge (src/phone/bridge.js imports this file too).
//
// Per-response instructions REPLACE the scammer's character prompt. The old wording ("step out of character and
// say exactly this") left the model with no role at all, so it fell back to a generic assistant: it greeted the
// person ("Hi there! What would you like help with today?"), refused, or improvised its own safety advice
// instead of the line. Giving it a clear new job (a narrator reading a closing script) fixed that: in tests it
// read the line word for word every time.

export function unmaskInstructions(line) {
  return (
    "The practice call is over, and the scam character is finished. You are now the narrator of Loki, a " +
    "scam-awareness training app, speaking in the same voice. Your only job is to read the closing script below " +
    "out loud to the person, word for word, in a warm, kind, unhurried tone. Do not greet them, do not add anything " +
    "before or after it, do not change or skip any words, and do not answer or comment on it. After the last word, " +
    "stop.\n\nCLOSING SCRIPT:\n" +
    String(line ?? "").trim()
  );
}

// The scammer gave up and signed off ("...Goodbye.", "This call is over."). Checked on the end of its line only,
// so "don't say goodbye yet" in the middle of a sentence doesn't count. When this matches, the drill ends as
// passed and the unmask plays, instead of leaving the person on a silent line.
const GOODBYE = /\b(?:good ?bye|bye(?:-| )bye|bye now|this call is over|i(?:'|’| a)m ending (?:this|the) call)\b[^a-z]*$/i;

export function saidGoodbye(text) {
  return GOODBYE.test(String(text ?? "").trim().slice(-80));
}

// ---------- optional minimum call length ----------
// Off by default (0): the scenario prompts decide how long a call lasts (three pushbacks in total, then goodbye). Set a
// value in ms to make the clients refuse an earlier goodbye: the scammer is told how little time has passed and
// sent back in with a new tactic. The model can't tell how long a call has run, so the clients check the clock.
export const MIN_CALL_MS = 0;
export const MAX_REENGAGES = 3; // never loop: after this many tries a goodbye is allowed to end the drill

export function keepGoingNudge(elapsedMs) {
  const secs = Math.max(1, Math.round(elapsedMs / 1000));
  return (
    `Only about ${secs} seconds of this call have passed, so you are not done. Do not say goodbye. Briefly pick the conversation back up ` +
    "in character and come back at the person with a different tactic than the ones you have already used: more urgency, a firmer tone, " +
    "a made-up consequence from your story, an easier option, or an appeal to settling this quickly. One to three short sentences."
  );
}
