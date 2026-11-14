// Each scenario's scammer has its own OpenAI voice; OPENAI_REALTIME_VOICE overrides them all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceConfig, SCENARIO_VOICES, DEFAULT_REALTIME_VOICE } from "./config.js";
import { elevenConfig } from "./elevenlabs/config.js";
import { listScenarios } from "../scenarios/index.js";

function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test("voices: every scenario has its own voice, and an unknown one gets the default", () => {
  withEnv({ OPENAI_REALTIME_VOICE: "" }, () => {
    const voices = listScenarios().map(({ id }) => voiceConfig(id).voice);
    assert.deepEqual(voices.sort(), Object.values(SCENARIO_VOICES).sort());
    assert.equal(new Set(voices).size, voices.length);
    assert.equal(voiceConfig("nope").voice, DEFAULT_REALTIME_VOICE);
    assert.equal(voiceConfig().voice, DEFAULT_REALTIME_VOICE);
  });
});

test("voices: OPENAI_REALTIME_VOICE overrides every scenario", () => {
  withEnv({ OPENAI_REALTIME_VOICE: "ash" }, () => {
    for (const { id } of listScenarios()) assert.equal(voiceConfig(id).voice, "ash");
  });
});

test("provider: OpenAI unless VOICE_PROVIDER=elevenlabs", () => {
  withEnv({ VOICE_PROVIDER: "" }, () => assert.equal(elevenConfig().provider, "openai"));
  withEnv({ VOICE_PROVIDER: "ElevenLabs" }, () => assert.equal(elevenConfig().provider, "elevenlabs"));
});
