// The ElevenLabs scammer: per-call WebRTC tokens for the browser, and the unmask line spoken in the same voice.
// The API key stays on the server. The browser only ever gets a short-lived conversation token.
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { elevenConfig, loadAgents, UNMASK_TTS_MODEL, UPSTREAM_TIMEOUT_MS } from "./config.js";
import { upstreamError } from "../validate.js";

let client = null;
function getClient() {
  // The SDK reads ELEVENLABS_API_KEY from the environment.
  client ??= new ElevenLabsClient({ timeoutInSeconds: UPSTREAM_TIMEOUT_MS / 1000, maxRetries: 0 });
  return client;
}

/** The agent for a scenario when ElevenLabs is set up and selected, else null (the caller falls back to OpenAI). */
export function elevenAgentFor(scenarioId, { agents = loadAgents(), cfg = elevenConfig() } = {}) {
  if (cfg.provider !== "elevenlabs" || !cfg.apiKey) return null;
  const agent = agents[scenarioId];
  return agent?.agentId && agent?.voiceId ? agent : null;
}

/** @returns {Promise<string>} a WebRTC conversation token for this agent. */
export async function conversationToken(agentId, { api = getClient() } = {}) {
  let res;
  try {
    res = await api.conversationalAi.conversations.getWebrtcToken({ agentId });
  } catch (err) {
    throw upstreamError("Could not start the voice session", `elevenlabs_${err?.statusCode ?? "network"}`);
  }
  if (typeof res?.token !== "string" || !res.token) throw upstreamError("The voice service sent a bad response", "no_token");
  return res.token;
}

/** Speaks `text` in `voiceId`. @returns {Promise<Buffer>} MP3 audio. */
export async function speak(text, voiceId, { api = getClient() } = {}) {
  let stream;
  try {
    stream = await api.textToSpeech.convert(voiceId, {
      text,
      modelId: UNMASK_TTS_MODEL,
      outputFormat: "mp3_44100_128",
    });
  } catch (err) {
    throw upstreamError("Could not make the unmask audio", `elevenlabs_${err?.statusCode ?? "network"}`);
  }
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
