// Owned by Agent L. The deterministic half of the ref. Pure, synchronous, never throws.
// checkRules({ victimLine, lastScammerLine, secondsSinceRedFlag, alreadyStruck }) -> RefEvent[]
import { makeEvent } from "../shared/contract.js";
import { normalizeNumbers, lower } from "./normalize.js";
import { findAutofail } from "./autofails.js";
import { findStrikes } from "./strikes.js";

/**
 * @param victimLine          RAW text (real digits). Every quote we return is redacted by makeEvent.
 * @param lastScammerLine     what the scammer said just before
 * @param secondsSinceRedFlag seconds since the scammer's first red-flag phrase (0 if none yet)
 * @param alreadyStruck       Set of strike types this call already has
 * @param t                   optional: seconds since the call started, copied onto the event
 *
 * Returns at most one event per line:
 *   - an autofail, alone, if one fires
 *   - otherwise the first strike the victim hasn't already been given ("one call per play")
 */
export function checkRules({
  victimLine,
  lastScammerLine = "",
  secondsSinceRedFlag = 0,
  alreadyStruck = new Set(),
  t = 0,
} = {}) {
  try {
    if (typeof victimLine !== "string" || !victimLine.trim()) return [];

    // Spoken numbers become digits first, so "four five one two" is caught and then redacted.
    const normalized = normalizeNumbers(victimLine);
    const scammer = lower(lastScammerLine);
    const event = (tier, hit) => makeEvent({ tier, type: hit.type, quote: hit.quote, source: "rules", t });

    const autofail = findAutofail(normalized, scammer);
    if (autofail) return [event("autofail", autofail)];

    const struck = alreadyStruck instanceof Set ? alreadyStruck : new Set(alreadyStruck ?? []);
    const strike = findStrikes(normalized, scammer, Number(secondsSinceRedFlag) || 0).find(
      (s) => !struck.has(s.type),
    );
    return strike ? [event("strike", strike)] : [];
  } catch {
    return [];
  }
}
