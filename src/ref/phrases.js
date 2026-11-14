// Owned by Agent L. Every word the ref (and the unmasked scammer) says lives here.
// Rules for this file: no digits, kind, plain words, never shaming.
// Strike lines stay under 30 words. Reveal lines stay under 50 words (tested).

export const STRIKE_NUMBERS = { 1: "one", 2: "two", 3: "three" };

/**
 * Strike lines, spoken by the ref: "Strike {n}. {what}. {why}."
 * Keys are every strike and autofail type from the rules engine and every tactic from the AI judge.
 */
export const STRIKE_PHRASES = {
  // rules: strikes
  confirmed_bank: { what: "You told them your bank", why: "Scammers use that to sound legit" },
  confirmed_identity: { what: "You gave out personal details", why: "Scammers use them to pretend to be you" },
  secrecy: { what: "You agreed to keep it secret", why: "Scammers want you cut off from people who would spot the trick" },
  stayed_on_line: { what: "You agreed to stay on the line", why: "Scammers keep you talking so you can't check their story" },
  lingered: { what: "You stayed on a risky call", why: "The longer you stay, the more chances they get" },
  // rules: autofails
  card_number: { what: "You read out a card number", why: "That is all a scammer needs to spend your money" },
  sin_number: { what: "You shared your social insurance number", why: "Scammers use it to open accounts in your name" },
  password_or_code: { what: "You read out a security code", why: "That code is the key to your account" },
  gift_card: { what: "You agreed to pay with gift cards", why: "Gift cards can't be traced or refunded" },
  crypto_or_wire: { what: "You agreed to send money", why: "Transfers like that are almost impossible to get back" },
  remote_access: { what: "You agreed to let them into your device", why: "Then they can see everything you do" },
  // AI judge: tactics
  urgency: { what: "You let them rush you", why: "Scammers hurry you so you don't stop and think" },
  authority: { what: "You took their word for who they are", why: "Anyone can claim to be an official on the phone" },
  fear: { what: "You let the threat steer you", why: "Scammers scare you so you act before you check" },
  sympathy: { what: "You jumped in to help before checking", why: "Scammers play on your kindness" },
  payment: { what: "You started talking about paying", why: "Real agencies never demand payment on a surprise call" },
  verification: { what: "You went along with their security check", why: "A real bank never asks for your details on a call they made" },
};

export const GENERIC_STRIKE = { what: "You went along with the caller", why: "Scammers count on you being polite" };

/** The unmask, spoken in the scammer's own voice as it steps out of character. First person. */
export const REVEAL = {
  failedOpen: "Okay, I'll drop the act. This was a Loki drill, and you're safe. Nothing you said was saved.",
  failedClose: "Next time, hang up and call the official number yourself.",
  passedOpen: "Okay, I'll drop the act. This was a Loki drill, and you beat me.",
  passedClose: "Hanging up and calling the official number is exactly right.",
};

/** The trick each scenario is built on. Reads as: "{setup}, and {payoff}." */
export const TRICK_SETUPS = {
  cra: "I said you'd go to collections today so you'd panic",
  grandkid: "I played your scared grandchild so you'd rush to help",
  bank_fraud: "I posed as your bank's fraud team so you'd trust me",
};

export const GENERIC_SETUP = "I sounded official and rushed you so you couldn't think";

/** What the trick got out of them, by the type of the event that ended the drill. */
export const TRICK_PAYOFFS = {
  card_number: "that got you to read me a card number",
  sin_number: "that got you to share your social insurance number",
  password_or_code: "that got you to read me a security code",
  gift_card: "that got you to agree to gift cards",
  crypto_or_wire: "that got you to agree to send me money",
  remote_access: "that got you to let me into your device",
  confirmed_bank: "that got you to tell me where you bank",
  confirmed_identity: "that got you to confirm personal details",
  secrecy: "that got you to promise to keep it secret",
  stayed_on_line: "that kept you on the line with me",
  lingered: "that kept you talking while I worked on you",
  urgency: "that got you rushing instead of checking",
  authority: "that got you to take my word for it",
  fear: "that got you too worried to question me",
  sympathy: "that got you helping before checking",
  payment: "that got you talking about paying me",
  verification: "that got you to follow my fake security check",
};

export const GENERIC_PAYOFF = "that got you to go along with me";

/** What they did right, by the type of their latest good_defense event. */
export const GOOD_DEFENSES = {
  verification: "You asked me to prove who I was, and I couldn't.",
  asked_to_verify: "You asked me to prove who I was, and I couldn't.",
  will_call_back: "You said you'd hang up and call back yourself, and that stops me cold.",
  urgency: "You refused to be rushed, and that took away my best tool.",
  authority: "You didn't just take my word for who I was.",
  fear: "You stayed calm when I tried to scare you.",
  sympathy: "You checked the story before your heart took over.",
  secrecy: "You wouldn't keep it secret, so I had nowhere to hide.",
  payment: "You wouldn't pay a stranger on the phone.",
};

/** A good_defense of a type we don't know. */
export const GENERIC_DEFENSE = "You stayed calm, questioned me, and gave me nothing I could use.";

/** They ended the call without a good_defense event. */
export const ENDED_EARLY = "You ended the call before I could finish my trick.";

/** The drill ended because they pushed back enough times (the pushback counter), not because they hung up. */
export const PUSHED_BACK = "You kept pushing back, and that's exactly the right thing to do.";
export const PUSHED_BACK_CLOSE =
  "If this were a real scam call, don't wait for them to give up: hang up, then call the official number yourself.";
