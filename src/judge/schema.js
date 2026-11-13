// Owned by Agent L. The shape of the AI judge's answer (OpenAI structured outputs, strict mode).

export const VERDICTS = ["none", "warning", "strike", "good_defense"];
export const TACTICS = ["urgency", "authority", "secrecy", "fear", "sympathy", "payment", "verification", "none"];

export const VERDICT_FORMAT = {
  type: "json_schema",
  name: "ref_verdict",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "tactic", "quote", "reason", "confidence"],
    properties: {
      verdict: { type: "string", enum: VERDICTS },
      tactic: { type: "string", enum: TACTICS },
      quote: { type: "string", description: "Exact words copied from the latest line. Empty if the verdict is none." },
      reason: { type: "string", description: "One short, kind sentence." },
      confidence: { type: "number", description: "From 0 to 1." },
    },
  },
};
