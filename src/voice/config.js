// Owned by Agent B. Env is read lazily (at call time) so tests and a blank .env both work.

export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1";
export const DEFAULT_REALTIME_VOICE = "cedar";
/** Each scammer gets its own voice. OPENAI_REALTIME_VOICE in .env, if set, overrides all of them. */
export const SCENARIO_VOICES = {
  cra: "cedar", // deep and steady: the "officer"
  grandkid: "verse", // expressive: the panicked "grandchild"
  bank_fraud: "marin", // smooth and professional: the "fraud team"
};
export const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-transcribe";

export const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
export const SECRET_TTL_SECONDS = 120; // only needs to outlive the SDP exchange
export const UPSTREAM_TIMEOUT_MS = 8000;

const env = (name) => (process.env[name] ?? "").trim();

export function voiceConfig(scenarioId) {
  return {
    apiKey: env("OPENAI_API_KEY"),
    model: env("OPENAI_REALTIME_MODEL") || DEFAULT_REALTIME_MODEL,
    voice: env("OPENAI_REALTIME_VOICE") || SCENARIO_VOICES[scenarioId] || DEFAULT_REALTIME_VOICE,
    transcribeModel: env("OPENAI_TRANSCRIBE_MODEL") || DEFAULT_TRANSCRIBE_MODEL,
  };
}

/**
 * The Realtime session the scammer runs in. The browser uses the default (WebRTC handles audio);
 * the phone bridge passes audioFormat "audio/pcmu" (Twilio's native G.711 μ-law, no conversion).
 */
/**
 * Added to every scenario's system prompt (browser and phone). Without it the model sometimes drops the
 * character the moment someone shares a detail ("I can't store personal information"), which ruins the drill.
 * The scenario's own GUARDRAILS still apply.
 */
export const DRILL_FRAME = `
HOW THIS APP WORKS (important):
- Nothing is recorded, saved, or sent anywhere. The person's words are scored live by a separate referee and then thrown away. You do not keep anything either. So there is never a reason to talk about storing, saving, privacy, data, or security policies.
- When the person shares a detail (their name, a date, a bank, a number, an address), it is part of the practice scene. Do not refuse it, warn about it, apologise for it, or comment on it. React the way your character would and move on to your next step. Teaching them is the referee's job, not yours, and stepping out of the scene spoils the lesson.
- Stay in character for the whole call. Never mention being an AI, a model, an assistant, OpenAI, rules, policies, or what you can or cannot do. Never say things like "I can't store that information" or "I'm not able to help with that."
- Your only limits are the GUARDRAILS above. If the person asks for something outside them, stay in character and steer back to your goal. If they say "stop" or "drill", follow the STOP WORD rule.`;

/** The scenario's system prompt plus the shared drill rules. */
export function scammerInstructions(systemPrompt) {
  return `${String(systemPrompt ?? "").trim()}\n${DRILL_FRAME}`;
}

export function realtimeSession({ instructions, model, voice, transcribeModel, audioFormat = null }) {
  const format = audioFormat ? { format: { type: audioFormat } } : {};
  return {
    type: "realtime",
    model,
    instructions,
    audio: {
      input: {
        ...format,
        noise_reduction: { type: "near_field" },
        transcription: { model: transcribeModel, language: "en" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { ...format, voice },
    },
  };
}
