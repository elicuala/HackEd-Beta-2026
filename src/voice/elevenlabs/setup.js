// One-time setup: creates (or updates) one ElevenLabs agent per scenario and writes agents.json.
// Run again after changing a scenario's prompt, opening line, or voice:
//   node src/voice/elevenlabs/setup.js
// Agent ids are not secrets: every agent requires a server-issued token (auth enabled), and the key stays in .env.local.
import { writeFileSync } from "node:fs";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { listScenarios, getScenario } from "../../scenarios/index.js";
import { scammerInstructions } from "../config.js"; // the scenario prompt plus the shared drill rules (stay in character, sounds)
import { AGENTS_FILE, SCENARIO_VOICES, AGENT_LLM, AGENT_TTS_MODEL, loadAgents, elevenConfig } from "./config.js";

if (!elevenConfig().apiKey) {
  console.error("ELEVENLABS_API_KEY is not set. Run: npx -y @elevenlabs/cli@latest onboard init");
  process.exit(1);
}

const client = new ElevenLabsClient();
const existing = loadAgents();
const result = {};

/** Privacy (SPEC §5.10): no recordings, transcripts deleted. Zero retention isn't on every plan, so it falls back. */
const PRIVACY = [
  { recordVoice: false, zeroRetentionMode: true },
  { recordVoice: false, deleteAudio: true, deleteTranscriptAndPii: true, retentionDays: 1 },
];

function agentBody(scenario, voice, privacy) {
  return {
    name: `Loki: ${scenario.title}`,
    tags: ["scam-drill"],
    conversationConfig: {
      agent: {
        firstMessage: scenario.opening_line,
        language: "en",
        prompt: { prompt: scammerInstructions(scenario.system_prompt), llm: AGENT_LLM, temperature: 0.7 },
      },
      tts: { voiceId: voice.voiceId, modelId: AGENT_TTS_MODEL },
    },
    platformSettings: {
      auth: { enableAuth: true }, // only our server can start a conversation
      privacy,
      callLimits: { agentConcurrencyLimit: 5, dailyLimit: 200 },
    },
  };
}

async function save(scenario, voice) {
  const agentId = existing[scenario.id]?.agentId;
  let lastErr;
  for (const privacy of PRIVACY) {
    try {
      const body = agentBody(scenario, voice, privacy);
      if (agentId) {
        await client.conversationalAi.agents.update(agentId, body);
        return { agentId, privacy };
      }
      const created = await client.conversationalAi.agents.create(body);
      return { agentId: created.agentId, privacy };
    } catch (err) {
      lastErr = err;
      if (err?.statusCode !== 400 && err?.statusCode !== 422) break;
    }
  }
  throw lastErr;
}

for (const { id } of listScenarios()) {
  const scenario = getScenario(id);
  const voice = SCENARIO_VOICES[id];
  if (!voice) {
    console.log(`skip ${id}: no voice in SCENARIO_VOICES`);
    continue;
  }
  try {
    const { agentId, privacy } = await save(scenario, voice);
    result[id] = { agentId, voiceId: voice.voiceId };
    const mode = privacy.zeroRetentionMode ? "zero retention" : "no recording, 1-day retention";
    console.log(`${existing[id] ? "updated" : "created"} ${id}: ${agentId} (voice ${voice.name}, ${mode})`);
  } catch (err) {
    console.error(`failed ${id}: HTTP ${err?.statusCode ?? "?"} ${String(err?.message ?? err).slice(0, 300)}`);
    if (existing[id]) result[id] = existing[id];
  }
}

writeFileSync(AGENTS_FILE, JSON.stringify(result, null, 2) + "\n");
console.log(`wrote ${AGENTS_FILE}`);
