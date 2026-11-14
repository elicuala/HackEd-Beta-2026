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
