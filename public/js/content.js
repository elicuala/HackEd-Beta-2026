// Owned by Agent F. Words and icons the UI shows. Event types come from the logic branch (handoff/logic.md).

export const SCENARIO_UI = {
  cra: {
    icon: '<path d="M4 20h16M6 17v-7M10 17v-7M14 17v-7M18 17v-7M3 9l9-5 9 5z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
    habit: "Hang up and call the CRA using the number on its official website.",
  },
  bank_fraud: {
    icon: '<rect x="3" y="6" width="18" height="12" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M3 10.5h18M7 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    habit: "Hang up and call the number on the back of your card.",
  },
};
export const DEFAULT_HABIT =
  "When in doubt, hang up and call the number on the back of your card or the official website.";
const DEFAULT_ICON = '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8" fill="none"/>';
export const scenarioIcon = (id) => SCENARIO_UI[id]?.icon ?? DEFAULT_ICON;

/** Plain-language names for what the person did (strikes, red cards, warnings). */
export const NAMES = {
  card_number: "Read out a card number",
  sin_number: "Gave a SIN",
  password_or_code: "Read out a code or PIN",
  gift_card: "Agreed to buy gift cards",
  crypto_or_wire: "Agreed to send money",
  remote_access: "Agreed to install an app",
  confirmed_bank: "Named your bank",
  confirmed_identity: "Confirmed personal details",
  secrecy: "Agreed to keep it secret",
  stayed_on_line: "Agreed to stay on the line",
  lingered: "Stayed on after the red flags",
  urgency: "Felt rushed",
  authority: "Trusted the 'official' voice",
  fear: "Let the threat steer you",
  sympathy: "Jumped in to help",
  payment: "Talked about paying",
  verification: "Went along with their 'checks'",
  general: "The ref noticed something",
};

/** Names for good moves (the judge tags good_defense with the tactic it resisted). */
export const GOOD_NAMES = {
  verification: "Asked them to prove it",
  asked_to_verify: "Asked them to prove it",
  will_call_back: "Said you'd call back yourself",
  urgency: "Didn't let them rush you",
  authority: "Questioned their authority",
  secrecy: "Refused to keep it secret",
  fear: "Stayed calm under pressure",
  sympathy: "Checked before helping",
  payment: "Refused to pay",
  general: "Good move",
};

export const GOOD_LINES = {
  verification: "You asked them to prove who they were, and they couldn't.",
  asked_to_verify: "You asked them to prove who they were, and they couldn't.",
  will_call_back: "You said you'd hang up and call back yourself. That stops scammers cold.",
  urgency: "You didn't let them rush you.",
  authority: "You questioned whether they were really who they said.",
  secrecy: "You wouldn't keep it a secret from the people who'd spot the trick.",
  fear: "You stayed calm when they tried to scare you.",
  sympathy: "You checked the story before rushing to help.",
  payment: "You refused to pay.",
};

export function eventName(e) {
  if (!e) return "";
  if (e.tier === "good_defense") return GOOD_NAMES[e.type] ?? "Good move";
  return NAMES[e.type] ?? String(e.type ?? "").replace(/_/g, " ");
}

export const TIER = { strike: "Strike", autofail: "Red card", warning: "Warning", good_defense: "Good move" };
export const TIER_COLOR = { strike: "var(--red)", autofail: "var(--red-ink)", warning: "var(--orange)", good_defense: "var(--green)" };
export const DOWN = {
  low_confidence: "Downgraded: the AI wasn't sure enough to call a strike",
  repeat_type: "Downgraded: already called",
};
export const STATUS = {
  idle: "Ready",
  ringing: "Ringing",
  connecting: "Connecting",
  live: "On the call",
  scammer_speaking: "Caller speaking",
  ref_speaking: "Ref speaking",
  unmasking: "Dropping the act",
  ended: "Call ended",
};
export const NUM = { 1: "one", 2: "two", 3: "three" };

export const fmt = (s) => {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
