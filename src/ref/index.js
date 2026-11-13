// STUB (owned by Agent L). Replace with real, kind, plain-language ref lines. Keep this exact signature.
// scriptFor(action) -> { say: string|null, sound: "buzzer"|"chime"|null }
export function scriptFor(action) {
  switch (action?.type) {
    case "strike_called":
      return { say: `Strike ${action.strikeNumber}.`, sound: "buzzer" };
    case "credit_shown":
      return { say: null, sound: "chime" };
    case "reveal":
      return { say: "This was a Scam Drill. You're safe, and nothing you said was saved.", sound: "chime" };
    default:
      return { say: null, sound: null };
  }
}
