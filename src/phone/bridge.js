// Owned by Agent B. Bridges one Twilio Media Stream to one OpenAI Realtime WebSocket session.
//
// Twilio → OpenAI: caller audio (μ-law, base64) is appended to the input buffer (not while the ref talks).
// OpenAI → Twilio: scammer / ref / unmask audio deltas become Twilio media frames.
// Finished transcripts → processTurn (same rules as the browser). Actions → tones, the ref, the unmask, hang-up.
import WebSocket from "ws";
import { getCall, processTurn, endCall } from "../core/calls.js";
import { getScenario } from "../scenarios/index.js";
import { voiceConfig, realtimeSession } from "../voice/config.js";
import { toneMulaw } from "./mulaw.js";

const REALTIME_WS_URL = "wss://api.openai.com/v1/realtime";
const RESPONSE_TIMEOUT_MS = 12000;
const PLAYBACK_TIMEOUT_MS = 20000;

const log = (code) => console.error(`[phone] ${code}`);

/** Production OpenAI socket. Tests pass their own. */
export function openRealtimeSocket({ model, apiKey }) {
  return new WebSocket(`${REALTIME_WS_URL}?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

/**
 * @param twilioWs  the accepted Twilio Media Stream socket
 * @param deps {
 *   expectCall(callId, callSid) → boolean   // was this call placed by /api/phone/start (and not bridged yet)?
 *   hangup(callSid) → Promise               // Twilio REST: end the phone call
 *   openRealtime({ model, apiKey }) → ws    // optional, for tests
 *   now() → ms                              // optional, for tests
 *   timeouts?                               // optional, for tests
 * }
 */
export function bridgeCall(twilioWs, deps) {
  const openRealtime = deps.openRealtime ?? openRealtimeSocket;
  const now = deps.now ?? (() => Date.now());
  const responseTimeout = deps.timeouts?.response ?? RESPONSE_TIMEOUT_MS;
  const playbackTimeout = deps.timeouts?.playback ?? PLAYBACK_TIMEOUT_MS;

  let phase = "waiting"; // waiting → live → revealed → closed
  let callId = null;
  let callSid = null;
  let streamSid = null;
  let oa = null;
  let t0 = 0;
  let refSpeaking = false;
  let replyCut = false;
  let markSeq = 0;
  let tagSeq = 0;
  let queue = Promise.resolve();
  const kinds = new Map(); // response_id → { kind, tag }
  const markWaiters = new Map(); // mark name → resolve
  const doneWaiters = new Map(); // tag → resolve

  // ---------- helpers ----------

  const toTwilio = (msg) => {
    if (twilioWs.readyState === WebSocket.OPEN || twilioWs.readyState === 1) twilioWs.send(JSON.stringify(msg));
  };
  const toOpenAI = (ev) => {
    if (oa && oa.readyState === 1) oa.send(JSON.stringify(ev));
  };
  const clearPhone = () => toTwilio({ event: "clear", streamSid });
  const cancelReply = () => toOpenAI({ type: "response.cancel" });

  function timeout(ms, value) {
    return new Promise((r) => {
      const t = setTimeout(() => r(value), ms);
      t.unref?.();
    });
  }

  /** Resolves when Twilio has played everything sent before this mark. */
  function playbackDone() {
    const name = `m${++markSeq}`;
    const p = new Promise((resolve) => markWaiters.set(name, resolve));
    toTwilio({ event: "mark", streamSid, mark: { name } });
    return Promise.race([p, timeout(playbackTimeout, false)]).finally(() => markWaiters.delete(name));
  }

  function playTone(sound) {
    const buf = toneMulaw(sound);
    if (buf) toTwilio({ event: "media", streamSid, media: { payload: buf.toString("base64") } });
  }

  /** Out-of-band spoken line (doesn't enter the scammer's conversation). Resolves after it's played. */
  async function speak(kind, instructions) {
    const tag = `${kind}-${++tagSeq}`;
    const done = new Promise((resolve) => doneWaiters.set(tag, resolve));
    toOpenAI({
      type: "response.create",
      response: { conversation: "none", input: [], metadata: { kind, tag }, instructions },
    });
    await Promise.race([done, timeout(responseTimeout, false)]);
    doneWaiters.delete(tag);
    await playbackDone();
  }

  // ---------- turns and actions (one at a time, in order) ----------

  function enqueue(job) {
    queue = queue.then(job).catch(() => log("QUEUE_ERROR"));
    return queue;
  }

  function addTurn(speaker, text) {
    const clean = String(text ?? "").trim();
    if (!clean || phase !== "live") return;
    if (speaker === "victim" && refSpeaking) return;
    const t = Math.max(0, Math.round((now() - t0) / 100) / 10);
    enqueue(async () => {
      if (phase !== "live") return;
      let actions = [];
      try {
        actions = await processTurn(callId, { speaker, text: clean, t });
      } catch {
        log("TURN_FAILED");
        return;
      }
      for (const a of actions) await handleAction(a);
    });
  }

  async function handleAction(a) {
    if (phase !== "live") return;
    const say = a.ref?.say;
    // The ref stays quiet during the call so the conversation flows: strikes, warnings and good moves make no
    // sound on the phone. They still reach the dashboard (/phone.html) live, through the core's action stream.
    if (a.type === "reveal") {
      phase = "revealed";
      refSpeaking = true;
      cancelReply();
      clearPhone();
      playTone(a.ref?.sound);
      if (say) {
        await speak(
          "unmask",
          "The drill is over. Step out of character and say exactly this, kindly, and nothing else: " + JSON.stringify(say)
        );
      } else {
        await playbackDone();
      }
      await hangUp();
    }
  }

  // ---------- OpenAI events ----------

  function onOpenAI(raw) {
    let ev;
    try {
      ev = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (ev.type) {
      case "response.created": {
        const meta = ev.response?.metadata ?? {};
        const kind = meta.kind ?? "reply";
        kinds.set(ev.response?.id, { kind, tag: meta.tag ?? null });
        // A normal reply that starts while the ref talks (or after the reveal) is cancelled.
        if ((kind === "reply" || kind === "opening") && (refSpeaking || phase !== "live")) {
          if (refSpeaking && phase === "live") replyCut = true;
          toOpenAI({ type: "response.cancel", response_id: ev.response?.id });
        }
        return;
      }
      case "response.output_audio.delta": {
        const kind = kinds.get(ev.response_id)?.kind ?? "reply";
        const scammer = kind === "reply" || kind === "opening";
        if (scammer && (refSpeaking || phase !== "live")) return;
        toTwilio({ event: "media", streamSid, media: { payload: ev.delta } });
        return;
      }
      case "response.output_audio_transcript.done": {
        const kind = kinds.get(ev.response_id)?.kind ?? "reply";
        if (kind === "reply" || kind === "opening") addTurn("scammer", ev.transcript);
        return;
      }
      case "conversation.item.input_audio_transcription.completed":
        addTurn("victim", ev.transcript);
        return;
      case "input_audio_buffer.speech_started":
        // Barge-in: the person talked over the scammer. Stop what's queued on the phone.
        if (!refSpeaking && phase === "live") clearPhone();
        return;
      case "response.done": {
        const info = kinds.get(ev.response?.id);
        if (info?.tag) doneWaiters.get(info.tag)?.(true);
        if (info && (info.kind === "reply" || info.kind === "opening") && ev.response?.status === "cancelled" && refSpeaking) {
          replyCut = true;
        }
        return;
      }
      case "error":
        log(`REALTIME_${String(ev.error?.code ?? ev.error?.type ?? "ERROR").toUpperCase()}`);
        return;
      default:
    }
  }

  // ---------- lifecycle ----------

  function startBridge(start) {
    streamSid = start.streamSid;
    callSid = start.callSid;
    callId = start.customParameters?.callId ?? null;
    const call = callId ? getCall(callId) : null;
    if (!call || call.channel !== "phone" || call.status !== "live" || !deps.expectCall(callId, callSid)) {
      log("STREAM_REJECTED");
      return close();
    }
    const cfg = voiceConfig(call.scenarioId);
    if (!cfg.apiKey) {
      log("UPSTREAM_ERROR");
      return hangUp();
    }
    const scenario = getScenario(call.scenarioId);
    phase = "live";
    t0 = now();
    oa = openRealtime({ model: cfg.model, apiKey: cfg.apiKey });
    oa.on("open", () => {
      toOpenAI({
        type: "session.update",
        session: realtimeSession({ instructions: scenario.system_prompt, ...cfg, audioFormat: "audio/pcmu" }),
      });
      toOpenAI({
        type: "response.create",
        response: {
          metadata: { kind: "opening" },
          instructions:
            "The call has just connected. Say this opening line naturally, then stop and wait for the person to reply: " +
            JSON.stringify(scenario.opening_line),
        },
      });
    });
    oa.on("message", onOpenAI);
    oa.on("error", () => log("UPSTREAM_ERROR"));
    oa.on("close", () => {
      if (phase === "live") {
        log("CONNECTION_LOST");
        callerHungUp();
      }
    });
  }

  async function hangUp() {
    if (phase === "closed") return;
    phase = "closed";
    try {
      if (callSid) await deps.hangup(callSid);
    } catch {
      log("HANGUP_FAILED");
    }
    close();
  }

  /** The person hung up (or the line dropped) while the drill was live → the core reveals "passed". */
  function callerHungUp() {
    const wasLive = phase === "live";
    phase = "closed";
    if (wasLive && callId) endCall(callId).catch(() => {});
    close();
  }

  let closedOnce = false;
  function close() {
    phase = "closed";
    if (closedOnce) return;
    closedOnce = true;
    for (const resolve of markWaiters.values()) resolve(false);
    for (const resolve of doneWaiters.values()) resolve(false);
    try {
      oa?.close();
    } catch {
      /* ignore */
    }
    try {
      twilioWs.close();
    } catch {
      /* ignore */
    }
    deps.onClosed?.(callId);
  }

  twilioWs.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.event) {
      case "start":
        if (phase === "waiting") startBridge(msg.start ?? {});
        return;
      case "media":
        if (phase === "live" && !refSpeaking && msg.media?.payload) {
          toOpenAI({ type: "input_audio_buffer.append", audio: msg.media.payload });
        }
        return;
      case "mark":
        markWaiters.get(msg.mark?.name)?.(true);
        return;
      case "stop":
        if (phase === "live") callerHungUp();
        else close();
        return;
      default:
    }
  });
  twilioWs.on("close", () => {
    if (phase === "live") callerHungUp();
    else if (phase !== "closed") close();
  });
  twilioWs.on("error", () => log("TWILIO_SOCKET_ERROR"));

  return { get phase() { return phase; } };
}
