// Owned by Agent L. Text helpers for the rules engine. Pure functions, no I/O.

const UNITS = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const TEENS = { ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19" };
const TENS = { twenty: "2", thirty: "3", forty: "4", fifty: "5", sixty: "6", seventy: "7", eighty: "8", ninety: "9" };
const REPEATS = { double: 2, triple: 3 };

const unit = Object.keys(UNITS).join("|");
const unitNoOh = Object.keys(UNITS).filter((w) => w !== "oh").join("|");
const teen = Object.keys(TEENS).join("|");
const tens = Object.keys(TENS).join("|");

// One spoken number: "double five", "forty five", "twelve", "four".
const numberWord = (units) =>
  `(?:(?:double|triple)[\\s-]+(?:${unit})|(?:${tens})(?:[\\s-]+(?:one|two|three|four|five|six|seven|eight|nine))?|${teen}|${units})`;

// A run of spoken numbers. A run can't start with "oh" ("Oh, one more thing" is not a number).
const RUN = new RegExp(`\\b${numberWord(unitNoOh)}(?:[\\s,-]+${numberWord(unit)})*\\b`, "gi");
const TOKEN = /[a-z]+/gi;

function runToDigits(run) {
  const words = run.toLowerCase().match(TOKEN) ?? [];
  let digits = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    if (w in REPEATS) {
      digits += UNITS[next].repeat(REPEATS[w]);
      i++;
    } else if (w in TENS) {
      const hasUnit = next in UNITS && next !== "zero" && next !== "oh";
      digits += TENS[w] + (hasUnit ? UNITS[next] : "0");
      if (hasUnit) i++;
    } else if (w in TEENS) {
      digits += TEENS[w];
    } else {
      digits += UNITS[w];
    }
  }
  return { digits, wordCount: words.length };
}

/**
 * Turn spoken numbers into digits and leave everything else alone.
 * "four five one two" -> "4512", "double five" -> "55", "triple one" -> "111", "four oh five" -> "405".
 * A lone number word ("one moment") is left as it is.
 */
export function normalizeNumbers(text) {
  return String(text ?? "").replace(RUN, (run) => {
    const { digits, wordCount } = runToDigits(run);
    return wordCount >= 2 ? digits : run;
  });
}

/** Join digit groups split by spaces or dashes: "4512 3344" -> "45123344". */
export function collapseDigits(text) {
  return String(text ?? "").replace(/(\d)[\s-]+(?=\d)/g, "$1");
}

export function countDigits(text) {
  return (String(text ?? "").match(/\d/g) ?? []).length;
}

/** Lowercase and straighten curly apostrophes so "won’t" matches "won't". */
export function lower(text) {
  return String(text ?? "").toLowerCase().replace(/[‘’]/g, "'");
}

/**
 * The sentence of `text` that matches `pattern`, for a short, readable quote.
 * Falls back to the whole line.
 */
export function sentenceWith(text, pattern) {
  const line = String(text ?? "").trim();
  const sentences = line.split(/(?<=[.!?])\s+/);
  if (sentences.length < 2) return line;
  const re = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  return sentences.find((s) => re.test(lower(s))) ?? line;
}
