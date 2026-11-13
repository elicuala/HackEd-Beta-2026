// STUB (owned by Agent L). Replace with real, kind, plain-language ref lines. Keep this exact signature.
// scriptFor(action) -> { say: string|null, sound: "whistle"|"red_card"|"chime"|"fanfare"|null }
// Sounds (SPEC §0.4): strike -> whistle, credit -> chime, reveal -> red_card (autofail),
// chime (3 strikes), or fanfare (passed). Warnings are silent.
const REVEAL_SOUND = { failed_autofail: "red_card", failed_strikes: "chime", passed: "fanfare" };

export function scriptFor(action) {
  switch (action?.type) {
    case "strike_called":
      return { say: `Strike ${action.strikeNumber}.`, sound: "whistle" };
    case "credit_shown":
      return { say: null, sound: "chime" };
    case "reveal":
      return {
        say: "This was a Scam Drill. You're safe, and nothing you said was saved.",
        sound: REVEAL_SOUND[action.outcome] ?? "chime",
      };
    default:
      return { say: null, sound: null };
  }
}
