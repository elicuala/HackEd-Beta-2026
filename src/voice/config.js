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
