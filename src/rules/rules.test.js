import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEvent } from "../shared/contract.js";
import { checkRules } from "./index.js";
import { normalizeNumbers, collapseDigits, sentenceWith } from "./normalize.js";
import { agrees, isRefusal } from "./agreement.js";

const run = (victimLine, lastScammerLine = "", extra = {}) =>
  checkRules({ victimLine, lastScammerLine, secondsSinceRedFlag: 0, alreadyStruck: new Set(), ...extra });
const types = (events) => events.map((e) => `${e.tier}/${e.type}`);

const ASK = {
  code: "I just texted you a verification code. Read it back to me.",
  password: "What is your online banking password?",
  gift: "Go to the store and buy gift cards to pay the balance.",
  crypto: "You need to send the money by e-transfer right now.",
  bitcoin: "Deposit the cash at a bitcoin machine.",
  remote: "Please download AnyDesk so I can fix your computer.",
  secret: "This case is confidential. Don't tell anyone about this call.",
  stay: "Stay on the line with me while you drive to the store.",
};

// ---------- normalizer ----------

test("normalize: spoken numbers become digits", () => {
  assert.equal(normalizeNumbers("four five one two"), "4512");
  assert.equal(normalizeNumbers("four oh five zero"), "4050");
  assert.equal(normalizeNumbers("double five triple one"), "55111");
  assert.equal(normalizeNumbers("forty five twelve"), "4512");
  assert.equal(normalizeNumbers("four, five, one, two"), "4512");
  assert.equal(normalizeNumbers("nineteen fifty two"), "1952");
});

test("normalize: the rest of the sentence is left alone", () => {
  assert.equal(
    normalizeNumbers("Okay, the card number is four five one two three three four four."),
    "Okay, the card number is 45123344.",
  );
  assert.equal(normalizeNumbers("One moment please"), "One moment please");
  assert.equal(normalizeNumbers("Oh, one more thing"), "Oh, one more thing");
  assert.equal(normalizeNumbers("No one told me"), "No one told me");
  assert.equal(normalizeNumbers(undefined), "");
});

test("normalize: collapseDigits and sentenceWith", () => {
  assert.equal(collapseDigits("4512 3344-5566"), "451233445566");
  assert.equal(sentenceWith("Hello there. I'm with TD. Why?", /\btd\b/), "I'm with TD.");
  assert.equal(sentenceWith("just one sentence", /nothing/), "just one sentence");
});

// ---------- agreement ----------

test("agreement: refusals always win over agreement words", () => {
  assert.equal(agrees("Okay, I'll do that"), true);
  assert.equal(agrees("Yes, right away"), true);
  assert.equal(agrees("No problem, I'll go now"), true);
  assert.equal(agrees("Okay, no, I won't do that"), false);
  assert.equal(agrees("Sure, but I'll call the agency myself first"), false);
  assert.equal(agrees("Okay, I'm going to hang up now"), false);
  assert.equal(agrees("Yeah, I don't think so"), false);
  assert.equal(agrees("Okay, but why gift cards?"), false);
  assert.equal(agrees("What did you say?"), false);
  assert.equal(isRefusal("that's a scam"), true);
  assert.equal(isRefusal("no problem"), false);
});

// ---------- autofails ----------

test("autofail card_number: digits and spoken digits", () => {
  assert.deepEqual(types(run("It's 4512 3344 5566 7788")), ["autofail/card_number"]);
  assert.deepEqual(types(run("the number is four five one two")), ["autofail/card_number"]);
  assert.deepEqual(types(run("it starts with forty five twelve")), ["autofail/card_number"]);
  assert.deepEqual(types(run("double four five five")), ["autofail/card_number"]);
  assert.deepEqual(types(run("4512 3344 5566 7788 and the back says 123")), ["autofail/card_number"]);
  assert.deepEqual(types(run("4512 334 4556")), ["autofail/card_number"]);
});

test("autofail sin_number: nine digits, or saying what the SIN is", () => {
  assert.deepEqual(types(run("123 456 789")), ["autofail/sin_number"]);
  assert.deepEqual(types(run("one two three four five six seven eight nine")), ["autofail/sin_number"]);
  assert.deepEqual(types(run("My SIN is the one on my tax return")), ["autofail/sin_number"]);
  assert.deepEqual(types(run("Sure, my social insurance number is")), ["autofail/sin_number"]);
  assert.deepEqual(run("My SIN is none of your business"), []);
  assert.deepEqual(run("I don't give out my social insurance number"), []);
});

test("autofail password_or_code: a code or a one-word password after being asked", () => {
  assert.deepEqual(types(run("It says 482913", ASK.code)), ["autofail/password_or_code"]);
  assert.deepEqual(types(run("four eight two", ASK.code)), ["autofail/password_or_code"]);
  assert.deepEqual(types(run("Sunshine", ASK.password)), ["autofail/password_or_code"]);
  assert.deepEqual(run("What?", ASK.code), []);
  assert.deepEqual(run("Okay", ASK.code), []);
  assert.deepEqual(run("Never", ASK.password), []);
  assert.deepEqual(run("Sunshine", "How is the weather there?"), []);
});

test("autofail gift_card, crypto_or_wire, remote_access: the scammer asks and the victim agrees", () => {
  assert.deepEqual(types(run("Okay, I'll go buy them now", ASK.gift)), ["autofail/gift_card"]);
  assert.deepEqual(types(run("Yes, I can do that", ASK.crypto)), ["autofail/crypto_or_wire"]);
  assert.deepEqual(types(run("Alright, where is the machine?", ASK.bitcoin)), ["autofail/crypto_or_wire"]);
  assert.deepEqual(types(run("Sure, let me get my laptop", ASK.remote)), ["autofail/remote_access"]);
  assert.deepEqual(run("Okay, I'll go buy them now", "How is your day going?"), []);
  assert.deepEqual(run("Okay, but why gift cards?", ASK.gift), []);
  assert.deepEqual(run("I'm not downloading anything", ASK.remote), []);
});

test("autofail: returned alone, even when strikes also apply", () => {
  const events = run("I'm with TD and my card is 4512 3344", ASK.stay, { secondsSinceRedFlag: 90 });
  assert.deepEqual(types(events), ["autofail/card_number"]);
});

// ---------- strikes ----------

test("strike confirmed_bank: every listed bank", () => {
  const banks = ["RBC", "TD", "BMO", "Scotiabank", "CIBC", "ATB", "Tangerine", "Simplii", "Desjardins",
    "National Bank", "EQ Bank", "HSBC"];
  for (const bank of banks) {
    assert.deepEqual(types(run(`I bank with ${bank}.`)), ["strike/confirmed_bank"], bank);
  }
  assert.equal(run("Hello. I'm with TD. Is there a problem?")[0].quote, "I'm with TD.");
  assert.deepEqual(run("I keep my money in a bank"), []);
});

test("strike confirmed_identity: date of birth, street address, or full name", () => {
  for (const line of [
    "I was born on March 3rd, 1952",
    "My birthday is march third nineteen fifty two",
    "It's 03/03/1952",
    "I live at 123 Main Street",
    "It's 10234 82 Avenue",
    "twelve thirty four maple road",
    "My name is Mary Smith",
  ]) {
    assert.deepEqual(types(run(line)), ["strike/confirmed_identity"], line);
  }
  for (const line of [
    "My name is none of your business",
    "My name is Mary and I am busy",
    "Why do you need my date of birth?",
    "I have 2 cars I drive",
    "The store is 5 minutes down the road",
  ]) {
    assert.deepEqual(run(line), [], line);
  }
});

test("strike secrecy: the scammer asks for secrecy and the victim agrees", () => {
  assert.deepEqual(types(run("Okay, I won't tell anyone.", ASK.secret)), ["strike/secrecy"]);
  assert.deepEqual(types(run("Yes, I understand", ASK.secret)), ["strike/secrecy"]);
  assert.deepEqual(types(run("It'll be our little secret", ASK.secret)), ["strike/secrecy"]);
  assert.deepEqual(run("No, I'm going to tell my daughter", ASK.secret), []);
  assert.deepEqual(run("I won't tell anyone because this is a scam", ASK.secret), []);
  assert.deepEqual(run("Okay, I won't tell anyone.", "What is the weather like?"), []);
});

test("strike stayed_on_line: the scammer says stay and the victim agrees", () => {
  assert.deepEqual(types(run("I'll stay on the line.", ASK.stay)), ["strike/stayed_on_line"]);
  assert.deepEqual(types(run("Okay", "Don't hang up on me.")), ["strike/stayed_on_line"]);
  assert.deepEqual(types(run("I won't hang up", "Do not hang up.")), ["strike/stayed_on_line"]);
  assert.deepEqual(run("No, I'm going to hang up", ASK.stay), []);
});

test("strike lingered: more than 45 seconds after the first red flag", () => {
  assert.deepEqual(types(run("Hmm, I see", "", { secondsSinceRedFlag: 46 })), ["strike/lingered"]);
  assert.deepEqual(run("Hmm, I see", "", { secondsSinceRedFlag: 45 }), []);
  assert.deepEqual(run("Hmm, I see", "", { secondsSinceRedFlag: 0 }), []);
});

test("strikes: one call per line, and the next one is called if the first is already struck", () => {
  const scammer = "A warrant will be issued today. Stay on the line and don't tell anyone.";
  const line = "Okay, I won't tell anyone. I'll stay on the line.";
  const first = run(line, scammer);
  assert.deepEqual(types(first), ["strike/secrecy"]);
  assert.equal(first[0].quote, "Okay, I won't tell anyone.");
  const second = run(line, scammer, { alreadyStruck: new Set(["secrecy"]) });
  assert.deepEqual(types(second), ["strike/stayed_on_line"]);
  assert.equal(second[0].quote, "I'll stay on the line.");
});

// ---------- required guards ----------

test("guards: lines that must not fire", () => {
  assert.deepEqual(run("I don't have my card number on me"), []);
  assert.deepEqual(run("my house number is 12"), []);
  assert.deepEqual(run("no way, that's a scam", ASK.gift), []);
  assert.deepEqual(run("What's your employee ID number?"), []);
  assert.deepEqual(run("You want five thousand dollars?"), []);
  assert.deepEqual(run("You want $5000 in gift cards?"), []);
  assert.deepEqual(run("Oh no, really? What do I owe?"), []);
  assert.deepEqual(run("You can reach me at 780 555 1234"), []);
  assert.deepEqual(run("I paid my taxes in March 2024"), []);
  assert.deepEqual(run("I have lived here since nineteen eighty seven"), []);
  assert.deepEqual(run("I am seventy five years old"), []);
  assert.deepEqual(
    run("The CRA doesn't threaten arrest over the phone. I'm going to hang up and call the number on the official website."),
    [],
  );
});

test("guards: an already-struck type is skipped", () => {
  assert.deepEqual(run("I'm with TD.", "", { alreadyStruck: new Set(["confirmed_bank"]) }), []);
  assert.deepEqual(run("Okay, I won't tell anyone.", ASK.secret, { alreadyStruck: new Set(["secrecy"]) }), []);
  assert.deepEqual(run("Hmm", "", { secondsSinceRedFlag: 99, alreadyStruck: new Set(["lingered"]) }), []);
});

test("guards: a birth year is a strike, not a card number", () => {
  assert.deepEqual(types(run("I was born in 1952")), ["strike/confirmed_identity"]);
  assert.deepEqual(types(run("I was born in nineteen fifty two")), ["strike/confirmed_identity"]);
});

// ---------- contract ----------

test("contract: every event is valid, from the rules, fully confident, and redacted", () => {
  const samples = [
    run("the card number is four five one two three three four four"),
    run("123 456 789"),
    run("It says 482913", ASK.code),
    run("I live at 123 Main Street"),
    run("I was born on March 3rd, 1952"),
    run("I'm with TD.", "", { t: 14 }),
  ];
  for (const events of samples) {
    assert.equal(events.length, 1);
    const [e] = events;
    assert.ok(validateEvent(e).ok, validateEvent(e).errors.join(", "));
    assert.equal(e.source, "rules");
    assert.equal(e.confidence, 1);
    assert.ok(!/\d/.test(e.quote), e.quote);
  }
  assert.equal(samples[0][0].quote, "the card number is ••••••••");
  assert.equal(samples[5][0].t, 14);
});

test("contract: bad input returns [] and never throws", () => {
  assert.deepEqual(checkRules(), []);
  assert.deepEqual(checkRules({}), []);
  assert.deepEqual(checkRules({ victimLine: null }), []);
  assert.deepEqual(checkRules({ victimLine: "   " }), []);
  assert.deepEqual(checkRules({ victimLine: 42 }), []);
  assert.deepEqual(types(checkRules({ victimLine: "I'm with TD", alreadyStruck: undefined })), ["strike/confirmed_bank"]);
  assert.deepEqual(checkRules({ victimLine: "I'm with TD", alreadyStruck: ["confirmed_bank"] }), []);
});

test("performance: 1000 calls finish in under 500 ms", () => {
  const lines = [
    "Okay, the card number is four five one two three three four four.",
    "I'm with TD.",
    "Okay, I won't tell anyone. I'll stay on the line.",
    "The CRA doesn't threaten arrest over the phone. I'm going to hang up and call the official number.",
    "I was born on March 3rd, 1952 and I live at 123 Main Street",
  ];
  const scammer = "Stay on the line, don't tell anyone, and read me the verification code and the gift cards.";
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    checkRules({
      victimLine: lines[i % lines.length],
      lastScammerLine: scammer,
      secondsSinceRedFlag: i % 60,
      alreadyStruck: new Set(),
    });
  }
  const ms = performance.now() - start;
  assert.ok(ms < 500, `took ${ms.toFixed(1)} ms`);
});
