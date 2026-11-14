// Owned by Agent B. Mints a short-lived Realtime client secret. The real API key never leaves the server.
import {
  voiceConfig,
  realtimeSession,
  CLIENT_SECRETS_URL,
  SECRET_TTL_SECONDS,
  UPSTREAM_TIMEOUT_MS,
} from "./config.js";
import { upstreamError } from "./validate.js";

/**
 * @returns {Promise<{ value: string, expiresAt: number|null, model: string, voice: string }>}
 * Throws UPSTREAM_ERROR (502) on a missing key, network failure, timeout, non-2xx, or a malformed body.
 */
export async function mintClientSecret({ instructions, scenarioId }, { fetchImpl = globalThis.fetch } = {}) {
  const cfg = voiceConfig(scenarioId);
  if (!cfg.apiKey) throw upstreamError("Voice is not configured", "no_api_key");

  let res;
  try {
    res = await fetchImpl(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: SECRET_TTL_SECONDS },
        session: realtimeSession({ instructions, ...cfg }),
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    throw upstreamError("Could not reach the voice service", err?.name === "TimeoutError" ? "timeout" : "network");
  }

  if (!res.ok) throw upstreamError("The voice service refused the session", `http_${res.status}`);

  let body;
  try {
    body = await res.json();
  } catch {
    throw upstreamError("The voice service sent a bad response", "bad_json");
  }
  const value = typeof body?.value === "string" ? body.value : body?.client_secret?.value;
  if (typeof value !== "string" || !value) {
    throw upstreamError("The voice service sent a bad response", "no_secret");
  }
  return {
    value,
    expiresAt: typeof body.expires_at === "number" ? body.expires_at : null,
    model: cfg.model,
    voice: cfg.voice,
  };
}
