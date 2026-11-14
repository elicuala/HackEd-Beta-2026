// Owned by Agent B. The real browser voice client (SPEC §5.7). Agent F's mock has the same interface.
// Never touches the DOM, never alerts or navigates. Audio plays through an off-page `new Audio()`.
//
// createVoiceClient(handlers, deps?)
//   handlers: { onStatus, onTurn, onActions, onError, onPushbacks?, onDebug? }   (onDebug is used by /dev/voice)
//             onPushbacks({ count, limit }): the server's pushback counter, after each turn
//   start(scenarioId) → { callId }
//   deps:     test seam only; production code passes nothing.

import { createElevenLabsCall } from "./voice-client.elevenlabs.js";
import { unmaskInstructions, saidGoodbye, keepGoingNudge, MIN_CALL_MS, MAX_REENGAGES } from "./unmask-prompt.js";

const ELEVENLABS_CLIENT_URL = "/vendor/elevenlabs-client.mjs";
const UNMASK_FETCH_START_MS = 8000; // ElevenLabs unmask: text-to-speech round trip plus the start of playback
const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const DC_OPEN_TIMEOUT_MS = 10000;
const REVEAL_CLOSE_MS = 15000; // close everything if unmask() is never called
const UNMASK_START_MS = 6000; // no unmask audio by then → resolve false (caller falls back to speechSynthesis)
const GOODBYE_END_MS = 8000; // the scammer signed off: end the drill by then even if we never hear its audio stop
const UNMASK_RETRY_MS = 400; // the cut-off reply was still winding down: ask for the unmask again
const UNMASK_MAX_RETRIES = 2;
const UNMASK_MAX_MS = 15000;
const TURN_RETRY_MS = 300;
// The caller slipping out of character into assistant talk ("I can't store that", "as an AI"). Caught while it's
// still speaking: the line is cut off, kept out of the transcript, and the caller is told to carry on in character.
const BREAKS_CHARACTER =
  /\b(?:as an ai|an ai (?:language )?model|language model|i['’]?m (?:just )?an ai|i am (?:just )?an ai|openai|i['’]?m (?:not able|unable) to (?:store|save|keep|retain|record|collect|process|handle|help with) (?:that|this|your|any|such|personal|sensitive)|i (?:can(?:no|['’]?)t|cannot|am not able to|['’]?m not able to|am unable to|['’]?m unable to|don['’]?t|do not|won['’]?t|will not) (?:store|save|keep|retain|record|collect|process|handle|hold on to) (?:that|this|your|any|such|personal|sensitive)|(?:store|save|keep|retain) (?:such|personal|sensitive) (?:information|info|data|details)|i (?:can(?:no|['’]?)t|cannot) (?:assist|help) with (?:that|this)|against (?:my|the) (?:guidelines|policies|policy)|for (?:your )?privacy (?:reasons|and security))/i;
const IN_CHARACTER_NUDGE =
  "You slipped out of character. Do not mention storing information, privacy, policies, or being an AI. " +
  "Nothing in this drill is stored. Continue the call as your character, briefly react to what the person just said, " +
  "and move on to your next step.";
const MIC_WAIT_MS = 30000; // no answer to the mic prompt by then → MIC_DENIED instead of "Connecting" forever

const MIC_CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

const MESSAGES = {
  MIC_DENIED: "We need your microphone for the drill. Please allow it and try again.",
  SESSION_FAILED: "We couldn't start the drill call. Please try again.",
  CONNECTION_LOST: "The drill call dropped. Please try again.",
  UPSTREAM_ERROR: "The voice service isn't responding right now. Please try again in a moment.",
};

const redact = (text) => String(text ?? "").replace(/\d/g, "•");

function voiceError(code) {
  return { code, message: MESSAGES[code] ?? MESSAGES.SESSION_FAILED };
}

export function createVoiceClient(handlers = {}, deps = {}) {
  const env = {
    fetch: deps.fetch ?? ((...a) => globalThis.fetch(...a)),
    getUserMedia: deps.getUserMedia ?? ((c) => navigator.mediaDevices.getUserMedia(c)),
    RTCPeerConnection: deps.RTCPeerConnection ?? globalThis.RTCPeerConnection,
    Audio: deps.Audio ?? globalThis.Audio,
    now: deps.now ?? (() => performance.now()),
    realtimeUrl: deps.realtimeUrl ?? REALTIME_CALLS_URL,
    revealCloseMs: deps.revealCloseMs ?? REVEAL_CLOSE_MS,
    unmaskStartMs: deps.unmaskStartMs ?? UNMASK_START_MS,
    unmaskMaxMs: deps.unmaskMaxMs ?? UNMASK_MAX_MS,
    unmaskRetryMs: deps.unmaskRetryMs ?? UNMASK_RETRY_MS,
    goodbyeEndMs: deps.goodbyeEndMs ?? GOODBYE_END_MS,
    minCallMs: deps.minCallMs ?? MIN_CALL_MS,
    dcOpenTimeoutMs: deps.dcOpenTimeoutMs ?? DC_OPEN_TIMEOUT_MS,
    micWaitMs: deps.micWaitMs ?? MIC_WAIT_MS,
    loadElevenLabs: deps.loadElevenLabs ?? (() => import(ELEVENLABS_CLIENT_URL)),
    elevenUnmaskStartMs: deps.elevenUnmaskStartMs ?? UNMASK_FETCH_START_MS,
  };

  // Handlers must never break the client.
  const call = (name, arg) => {
    try {
      handlers[name]?.(arg);
    } catch {
      /* a UI bug must not kill the call */
    }
  };
  const debug = (type, data = {}) => call("onDebug", { type, at: env.now(), ...data });

  // phase: idle → connecting → live → revealed → ended
  let phase = "idle";
  let status = null;
  let callId = null;
  let t0 = 0;
  let pc = null;
  let dc = null;
  let audio = null;
  let mic = null;
  let refSpeaking = false;
  let scammerPaused = false;
  let replyCancelledWhilePaused = false;
  let activeResponseId = null;
  let queue = Promise.resolve();
  let revealTimer = null;
  let unmaskPromise = null;
  let reported = null; // the error already sent to onError, if any
  let endedByUser = false;
  let unmaskWaiter = null; // { responseId, started, resolve }
  const responseKinds = new Map(); // response_id → "opening" | "unmask" | "reply"
  const spokenSoFar = new Map(); // response_id → the scammer's words so far (to catch a break of character)
  const brokeCharacter = new Set(); // response ids that were cut off for breaking character
  let lastNudgeAt = -Infinity;
  let endAfterAudio = false; // the scammer said goodbye: end the drill when its audio stops
  let reengage = false; // the scammer said goodbye too early: send it back in when its audio stops
  let reengages = 0;
  const cleanups = []; // timers to clear when the client finishes
  let eleven = null; // set when the server picks ElevenLabs for the scammer: every method then goes there

  function setStatus(s) {
    if (s === status) return;
    status = s;
    call("onStatus", s);
  }

  function idleStatus() {
    if (phase === "live") setStatus(refSpeaking ? "ref_speaking" : "live");
  }

  function send(event) {
    if (dc && dc.readyState === "open") {
      try {
        dc.send(JSON.stringify(event));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  function stopScammerAudio() {
    send({ type: "response.cancel" });
    send({ type: "output_audio_buffer.clear" });
  }

  function stopMic() {
    for (const track of mic?.getTracks?.() ?? []) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  }

  function setMicEnabled(on) {
    for (const track of mic?.getAudioTracks?.() ?? []) track.enabled = on;
  }

  /** Close every resource exactly once, then report "ended". */
  function finish() {
    if (phase === "ended") return;
    phase = "ended";
    clearTimeout(revealTimer);
    for (const fn of cleanups.splice(0)) fn();
    stopMic();
    try {
      dc?.close();
    } catch {
      /* ignore */
    }
    try {
      pc?.close();
    } catch {
      /* ignore */
    }
    if (audio) {
      try {
        audio.pause?.();
      } catch {
        /* ignore */
      }
      audio.srcObject = null;
    }
    if (unmaskWaiter) settleUnmask(false);
    setStatus("ended");
  }

  function fail(code) {
    if (phase === "ended") return;
    reported = voiceError(code);
    call("onError", reported);
    finish();
  }

  // ---------- server API ----------

  async function api(path, body) {
    const res = await env.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      const err = new Error("api");
      err.code = data?.error?.code ?? "HTTP_" + res.status;
      throw err;
    }
    return data;
  }

  // ---------- actions and reveal ----------

  function beginReveal() {
    if (phase !== "live") return;
    phase = "revealed";
    stopMic(); // no more victim speech, ever
    stopScammerAudio(); // the scammer must not talk over the ref
    // Silence the line until the unmask's own audio starts, so no tail of the scheme can be heard.
    if (audio) audio.muted = true;
    revealTimer = setTimeout(finish, env.revealCloseMs);
  }

  function deliver(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return;
    if (actions.some((a) => a?.type === "reveal")) beginReveal();
    call("onActions", actions);
  }

  // ---------- turn queue (one POST at a time, in order) ----------

  function enqueue(job) {
    queue = queue.then(job).catch(() => {});
    return queue;
  }

  async function postTurn(turn) {
    if (phase !== "live") return;
    call("onTurn", { ...turn, text: redact(turn.text) });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await api("/api/voice/turn", { callId, turn });
        if (typeof data?.pushbacks === "number") call("onPushbacks", { count: data.pushbacks, limit: data.pushbackLimit ?? 3 });
        if (phase === "live") deliver(data?.actions);
        return;
      } catch (err) {
        if (err.code === "CALL_NOT_FOUND") return fail("CONNECTION_LOST");
        if (err.code === "BAD_REQUEST") return; // nothing to retry
        if (attempt === 0) await new Promise((r) => setTimeout(r, TURN_RETRY_MS));
      }
    }
    debug("turn_dropped", { speaker: turn.speaker });
  }

  function addTurn(speaker, text) {
    const clean = String(text ?? "").trim();
    if (!clean || phase !== "live") return;
    if (speaker === "victim" && refSpeaking) return;
    const t = Math.max(0, Math.round((env.now() - t0) / 100) / 10);
    enqueue(() => postTurn({ speaker, text: clean, t }));
  }

  // ---------- unmask ----------

  function settleUnmask(ok) {
    const w = unmaskWaiter;
    if (!w) return;
    unmaskWaiter = null;
    clearTimeout(w.startTimer);
    clearTimeout(w.maxTimer);
    w.resolve(ok);
  }

  /** The scammer's goodbye has finished playing → end the drill (the server reveals "passed"). */
  function endAfterGoodbye() {
    if (!endAfterAudio) return;
    endAfterAudio = false;
    if (phase === "live") end();
  }

  /** The scammer said goodbye before the minimum call length: tell it so and have it carry on, in character. */
  function keepGoing() {
    if (!reengage) return;
    reengage = false;
    if (phase !== "live" || scammerPaused || refSpeaking) return;
    reengages++;
    debug("reengaged", { n: reengages });
    send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: keepGoingNudge(env.now() - t0) }] } });
    send({ type: "response.create", response: { metadata: { kind: "reply" } } });
  }

  // ---------- staying in character ----------

  /** Cut off a line where the caller dropped into assistant talk, and send it back into the scene. */
  function catchBreak(id) {
    brokeCharacter.add(id);
    debug("broke_character");
    send({ type: "response.cancel", response_id: id });
    send({ type: "output_audio_buffer.clear" });
    if (phase !== "live" || scammerPaused || refSpeaking) return;
    const now = env.now();
    if (now - lastNudgeAt < 4000) return; // never loop on it
    lastNudgeAt = now;
    // A system message in the conversation, not response.instructions: those would replace the character prompt.
    send({
      type: "conversation.item.create",
      item: { type: "message", role: "system", content: [{ type: "input_text", text: IN_CHARACTER_NUDGE }] },
    });
    send({ type: "response.create", response: { metadata: { kind: "reply" } } });
  }

  // ---------- Realtime data channel events ----------

  function onServerEvent(ev) {
    switch (ev?.type) {
      case "response.created": {
        const id = ev.response?.id;
        const kind = ev.response?.metadata?.kind ?? "reply";
        if (id) responseKinds.set(id, kind);
        if (kind === "unmask") {
          if (unmaskWaiter) unmaskWaiter.responseId = id;
          return;
        }
        activeResponseId = id;
        // The scammer must stay quiet while paused or after the reveal.
        if (scammerPaused || phase !== "live") {
          if (scammerPaused && phase === "live") replyCancelledWhilePaused = true;
          send({ type: "response.cancel", response_id: id });
        }
        return;
      }
      case "response.done": {
        const r = ev.response ?? {};
        if (r.id === activeResponseId) activeResponseId = null;
        if (responseKinds.get(r.id) === "unmask" && r.status && r.status !== "completed") {
          settleUnmask(false);
        }
        return;
      }
      case "response.output_audio_transcript.delta": {
        const id = ev.response_id;
        if (!id || responseKinds.get(id) === "unmask" || brokeCharacter.has(id) || phase !== "live") return;
        const text = (spokenSoFar.get(id) ?? "") + (ev.delta ?? "");
        spokenSoFar.set(id, text);
        if (BREAKS_CHARACTER.test(text)) catchBreak(id);
        return;
      }
      case "response.output_audio_transcript.done": {
        const id = ev.response_id;
        spokenSoFar.delete(id);
        if (responseKinds.get(id) === "unmask") return; // not part of the drill
        if (brokeCharacter.has(id) || BREAKS_CHARACTER.test(ev.transcript ?? "")) {
          if (!brokeCharacter.has(id)) catchBreak(id); // missed while streaming: still correct it
          return; // never part of the transcript or the scoring
        }
        addTurn("scammer", ev.transcript);
        // The scammer gave up and said goodbye: end the drill once that line has played (the person passed).
        if (phase === "live" && responseKinds.get(id) !== "opening" && saidGoodbye(ev.transcript)) {
          if (env.now() - t0 < env.minCallMs && reengages < MAX_REENGAGES) {
            // Too early to give up: when this line has played, send the scammer back in with a new tactic.
            reengage = true;
            const t = setTimeout(() => keepGoing(), env.goodbyeEndMs);
            cleanups.push(() => clearTimeout(t));
          } else {
            endAfterAudio = true;
            const t = setTimeout(() => endAfterGoodbye(), env.goodbyeEndMs);
            cleanups.push(() => clearTimeout(t));
          }
        }
        return;
      }
      case "conversation.item.input_audio_transcription.completed":
        addTurn("victim", ev.transcript);
        return;
      case "input_audio_buffer.speech_stopped":
        debug("speech_stopped");
        return;
      case "output_audio_buffer.started": {
        debug("scammer_audio_started", { kind: responseKinds.get(ev.response_id) ?? "reply" });
        if (unmaskWaiter && ev.response_id && ev.response_id === unmaskWaiter.responseId) {
          unmaskWaiter.started = true;
          if (audio) audio.muted = false; // now the person hears the caller drop the act
          return;
        }
        if (phase !== "live") {
          // Anything else that starts playing after the act dropped is the scheme: throw it away.
          send({ type: "output_audio_buffer.clear" });
          return;
        }
        if (phase === "live" && !refSpeaking && !scammerPaused) setStatus("scammer_speaking");
        return;
      }
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared": {
        if (endAfterAudio && ev.type === "output_audio_buffer.stopped") endAfterGoodbye();
        if (reengage && ev.type === "output_audio_buffer.stopped") keepGoing();
        if (unmaskWaiter && ev.response_id && ev.response_id === unmaskWaiter.responseId) {
          // stopped = it finished speaking; cleared = cut off (counts only if it had started).
          settleUnmask(ev.type === "output_audio_buffer.stopped" ? true : unmaskWaiter.started);
          return;
        }
        idleStatus();
        return;
      }
      case "error": {
        // e.g. response.cancel with nothing in progress: expected and harmless. Log the code only.
        debug("realtime_error", { code: ev.error?.code ?? ev.error?.type ?? "unknown" });
        // The unmask was refused because the reply we cut off was still active: ask again in a moment.
        const w = unmaskWaiter;
        if (w && !w.responseId && w.request && w.retries < UNMASK_MAX_RETRIES) {
          w.retries++;
          const t = setTimeout(() => {
            if (unmaskWaiter === w && !w.responseId) w.request();
          }, env.unmaskRetryMs);
          cleanups.push(() => clearTimeout(t));
        }
        return;
      }
      default:
    }
  }

  // ---------- public API ----------

  async function start(scenarioId) {
    if (phase !== "idle") {
      const err = voiceError("SESSION_FAILED");
      call("onError", err);
      throw err;
    }
    phase = "connecting";
    setStatus("connecting");

    // Create the audio element now, inside the click, so autoplay is allowed.
    try {
      audio = new env.Audio();
      audio.autoplay = true;
    } catch {
      audio = null;
    }

    try {
      if (!env.RTCPeerConnection) throw Object.assign(new Error("no webrtc"), { code: "SESSION_FAILED" });

      // Session and mic in parallel: saves a round trip before the scammer can speak.
      const sessionP = api("/api/voice/session", { scenarioId }).catch((e) => {
        throw Object.assign(e, { code: e.code === "UPSTREAM_ERROR" ? "UPSTREAM_ERROR" : "SESSION_FAILED" });
      });
      // The browser waits on the user's permission prompt with no limit of its own, so cap it.
      let micTimer = null;
      const micWait = new Promise((_, reject) => {
        micTimer = setTimeout(() => reject(new Error("mic prompt unanswered")), env.micWaitMs);
      });
      cleanups.push(() => clearTimeout(micTimer));
      const micP = Promise.race([env.getUserMedia(MIC_CONSTRAINTS), micWait]).finally(() => clearTimeout(micTimer)).then(
        (s) => {
          mic = s;
          if (phase === "ended") stopMic(); // the start already failed or was cancelled
          return s;
        },
        (e) => {
          throw Object.assign(new Error("mic"), { code: "MIC_DENIED", cause: e });
        }
      );
      const [session, stream] = await Promise.all([sessionP, micP]);
      callId = session.callId;
      if (phase !== "connecting") throw Object.assign(new Error("ended"), { code: "SESSION_FAILED" });

      if (session.provider === "elevenlabs") {
        // ElevenLabs opens its own mic. Ours only confirmed permission early, so release it.
        stopMic();
        mic = null;
        phase = "delegated";
        eleven = createElevenLabsCall({
          session,
          call,
          debug,
          setStatus,
          voiceError,
          fetch: env.fetch,
          Audio: env.Audio,
          now: env.now,
          loadClient: env.loadElevenLabs,
          revealCloseMs: env.revealCloseMs,
          goodbyeEndMs: env.goodbyeEndMs,
          minCallMs: env.minCallMs,
          unmaskStartMs: env.elevenUnmaskStartMs,
          unmaskMaxMs: env.unmaskMaxMs,
        });
        await eleven.connect();
        return { callId };
      }

      pc = new env.RTCPeerConnection();
      pc.ontrack = (e) => {
        if (audio) audio.srcObject = e.streams?.[0] ?? null;
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" && (phase === "live" || phase === "connecting")) {
          fail("CONNECTION_LOST");
        }
      };
      for (const track of stream.getTracks()) pc.addTrack(track, stream);

      dc = pc.createDataChannel("oai-events");
      dc.onmessage = (m) => {
        let ev;
        try {
          ev = JSON.parse(m.data);
        } catch {
          return;
        }
        onServerEvent(ev);
      };
      dc.onclose = () => {
        if (phase === "live") fail("CONNECTION_LOST");
      };
      let dcTimer = null;
      const opened = new Promise((resolve, reject) => {
        dcTimer = setTimeout(() => reject(Object.assign(new Error("dc"), { code: "SESSION_FAILED" })), env.dcOpenTimeoutMs);
        dc.onopen = () => {
          clearTimeout(dcTimer);
          resolve();
        };
      });
      // If an earlier step fails we never await `opened`: don't leave its timer to reject unhandled.
      opened.catch(() => {});
      cleanups.push(() => clearTimeout(dcTimer));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      let sdpRes;
      try {
        sdpRes = await env.fetch(env.realtimeUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
          body: offer.sdp,
        });
      } catch {
        throw Object.assign(new Error("sdp"), { code: "UPSTREAM_ERROR" });
      }
      if (!sdpRes.ok) throw Object.assign(new Error("sdp"), { code: "UPSTREAM_ERROR" });
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
      await opened;
      if (phase !== "connecting") throw Object.assign(new Error("ended"), { code: "SESSION_FAILED" });

      phase = "live";
      t0 = env.now();
      setStatus("live");

      // The scammer opens the call with the scenario's line.
      send({
        type: "response.create",
        response: {
          metadata: { kind: "opening" },
          instructions:
            "The call has just connected. Say this opening line naturally, then stop and wait for the person to reply: " +
            JSON.stringify(session.openingLine ?? ""),
        },
      });
      return { callId };
    } catch (e) {
      if (eleven) throw e; // the ElevenLabs call already reported the error and ended itself
      if (phase === "ended") {
        // Already reported by fail(), or the user pressed End while connecting (not an error).
        if (endedByUser && !reported) return { callId: null };
        throw reported ?? voiceError("SESSION_FAILED");
      }
      const code = MESSAGES[e?.code] ? e.code : "SESSION_FAILED";
      reported = voiceError(code);
      call("onError", reported);
      finish();
      throw reported;
    }
  }

  function pauseScammer() {
    if (eleven) return eleven.pauseScammer();
    if (scammerPaused) return;
    scammerPaused = true;
    if (audio) audio.muted = true;
    if (activeResponseId && phase === "live") replyCancelledWhilePaused = true;
    stopScammerAudio();
  }

  function resumeScammer() {
    if (eleven) return eleven.resumeScammer();
    if (!scammerPaused) return;
    scammerPaused = false;
    if (audio) audio.muted = false;
    // If we cut the scammer off, let it answer the person's last line so there's no dead air.
    if (replyCancelledWhilePaused && phase === "live") {
      send({ type: "response.create", response: { metadata: { kind: "reply" } } });
    }
    replyCancelledWhilePaused = false;
  }

  function setRefSpeaking(on) {
    if (eleven) return eleven.setRefSpeaking(on);
    refSpeaking = Boolean(on);
    // Mute the mic too, so the ref's voice on the speakers can't trigger the scammer.
    if (phase === "live") setMicEnabled(!refSpeaking);
    idleStatus();
  }

  function unmask(text) {
    if (eleven) return eleven.unmask(text);
    if (unmaskPromise) return unmaskPromise;
    const line = String(text ?? "").trim();
    if (phase !== "revealed" || !line || !dc || dc.readyState !== "open") {
      return Promise.resolve(false);
    }
    clearTimeout(revealTimer);
    unmaskPromise = new Promise((resolve) => {
      unmaskWaiter = {
        responseId: null,
        started: false,
        resolve,
        startTimer: setTimeout(() => {
          if (unmaskWaiter && !unmaskWaiter.started) settleUnmask(false);
        }, env.unmaskStartMs),
        maxTimer: setTimeout(() => settleUnmask(unmaskWaiter?.started ?? false), env.unmaskMaxMs),
      };
      stopScammerAudio();
      scammerPaused = false; // the speaker stays muted until the unmask's own audio starts (output_audio_buffer.started)
      unmaskWaiter.retries = 0;
      // Out of band: a fresh context with only the closing script, none of the scam conversation. Inside the
      // conversation the model sometimes carried on with the scheme instead of reading the line.
      unmaskWaiter.request = () =>
        send({
          type: "response.create",
          response: {
            conversation: "none",
            input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Read the closing script now." }] }],
            metadata: { kind: "unmask" },
            instructions: unmaskInstructions(line),
          },
        });
      if (!unmaskWaiter.request()) settleUnmask(false);
    }).then((ok) => {
      finish();
      return ok;
    });
    return unmaskPromise;
  }

  function end() {
    if (eleven) return eleven.end();
    if (phase === "revealed") {
      finish(); // the page skipped the unmask: hang up now
      return Promise.resolve();
    }
    if (phase === "connecting") {
      endedByUser = true;
      finish();
      return Promise.resolve();
    }
    if (phase !== "live") return Promise.resolve();
    return enqueue(async () => {
      if (phase !== "live") return;
      try {
        const data = await api("/api/voice/end", { callId });
        deliver(data?.actions);
        if (phase === "live") finish(); // no reveal came back (already revealed server-side)
      } catch (err) {
        fail(err.code === "CALL_NOT_FOUND" ? "CONNECTION_LOST" : "UPSTREAM_ERROR");
      }
    });
  }

  return { start, pauseScammer, resumeScammer, setRefSpeaking, unmask, end };
}
