// ElevenLabs settings. The API key is read from the environment only (ELEVENLABS_API_KEY), never from code.
// `elevenlabs onboard` saved the key to .env.local; server.js only loads .env, so we load .env.local here too.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true }); // never overrides values already set

export const AGENTS_FILE = path.join(here, "agents.json");

/** The scammer agent and voice for each scenario. */
export const SCENARIO_VOICES = {
  cra: { voiceId: "pNInz6obpgDQGcFmaJgB", name: "Adam" }, // dominant, firm: the "officer"
  grandkid: { voiceId: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam" }, // young: the "grandchild"
  bank_fraud: { voiceId: "cjVigY5qzO86Huf0OWal", name: "Eric" }, // smooth, trustworthy: the "fraud team"
};

export const AGENT_LLM = "gemini-2.5-flash"; // fast enough for natural turn-taking
export const AGENT_TTS_MODEL = "eleven_flash_v2"; // English-only, lowest latency
export const UNMASK_TTS_MODEL = "eleven_flash_v2";
export const UNMASK_MAX_CHARS = 600;
export const UPSTREAM_TIMEOUT_MS = 8000;

/** scenarioId -> { agentId, voiceId }, written by setup.js. {} if setup hasn't run. */
export function loadAgents(file = AGENTS_FILE) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  } catch {
    return {};
  }
}

/**
 * Scenarios that use ElevenLabs when it's the provider: just the tax office call. The others stay on OpenAI
 * (the grandchild call is cut, and ElevenLabs' safety check still blocks the bank agent: calls connect and then
 * drop). Set ELEVENLABS_SCENARIOS in .env to change this: a comma list like "cra,bank_fraud", or "all".
 */
export const DEFAULT_ELEVEN_SCENARIOS = ["cra"];

export function elevenScenarios(raw = process.env.ELEVENLABS_SCENARIOS) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "all") return null; // no filter
  const list = text.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_ELEVEN_SCENARIOS;
}

export function elevenConfig() {
  return {
    apiKey: (process.env.ELEVENLABS_API_KEY ?? "").trim(),
    scenarios: elevenScenarios(),
    // OpenAI Realtime plays the scammer by default. VOICE_PROVIDER=elevenlabs switches to the ElevenLabs agents,
    // but ElevenLabs' safety review blocked them, so leave this unset unless ElevenLabs approves them.
    provider: (process.env.VOICE_PROVIDER ?? "").trim().toLowerCase() || "openai",
  };
}
