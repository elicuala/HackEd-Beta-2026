// The ElevenLabs scammer for the browser voice client (SPEC §5.7 interface, used by voice-client.js).
// voice-client.js fetches the session; when the server answers provider "elevenlabs" it hands the call here.
// Never touches the DOM, never alerts or navigates. The unmask plays through an off-page `new Audio()`.
//
// Transcripts from ElevenLabs go to the server as turns, exactly like the OpenAI path, so the ref works the same.

const TURN_RETRY_MS = 300;

const redact = (text) => String(text ?? "").replace(/\d/g, "•");
const codeError = (code) => Object.assign(new Error(code), { code });

/**
 * @param ctx {
 *   session,                       // { callId, conversationToken } from POST /api/voice/session
 *   call(name, arg), debug(type, data), setStatus(status), voiceError(code),
 *   fetch, Audio, now, loadClient, revealCloseMs, unmaskStartMs, unmaskMaxMs,
 * }
 */
export function createElevenLabsCall(ctx) {
  const { session, call, debug, setStatus, voiceError } = ctx;
  const callId = session.callId;

  // phase: connecting → live → revealed → ended
  let phase = "connecting";
  let conv = null;
  let t0 = ctx.now();
  let refSpeaking = false;
  let paused = false;
  let agentSpeaking = false;
  let queue = Promise.resolve();
  let revealTimer = null;
  let unmaskPromise = null;
  let unmaskAudio = null;
  let unmaskUrl = null;
  let reported = null;

  const idleStatus = () => {
    if (phase === "live") setStatus(refSpeaking ? "ref_speaking" : agentSpeaking && !paused ? "scammer_speaking" : "live");
  };

  function safely(fn) {
    try {
      fn();
    } catch {
      /* the SDK may already be closed */
    }
  }

  function applyAudio() {
    if (!conv) return;
    const muted = paused || phase !== "live";
    safely(() => conv.setVolume({ volume: muted ? 0 : 1 }));
    safely(() => conv.setMicMuted(paused || refSpeaking || phase !== "live"));
  }

  function stopConversation() {
    const c = conv;
    conv = null;
    if (c) c.endSession().catch?.(() => {});
  }

  function finish() {
    if (phase === "ended") return;
    phase = "ended";
    clearTimeout(revealTimer);
    stopConversation();
    if (unmaskAudio) {
      safely(() => unmaskAudio.pause());
      unmaskAudio = null;
    }
    if (unmaskUrl) safely(() => URL.revokeObjectURL(unmaskUrl));
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
    const res = await ctx.fetch(path, {
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
    if (!res.ok) throw codeError(data?.error?.code ?? "HTTP_" + res.status);
    return data;
  }

  function beginReveal() {
    if (phase !== "live") return;
    phase = "revealed";
    applyAudio(); // mic off, scammer silent
    stopConversation(); // the scammer must not talk over the ref
    revealTimer = setTimeout(finish, ctx.revealCloseMs);
  }

  function deliver(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return;
    if (actions.some((a) => a?.type === "reveal")) beginReveal();
    call("onActions", actions);
  }

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
        if (phase === "live") deliver(data?.actions);
        return;
      } catch (err) {
        if (err.code === "CALL_NOT_FOUND") return fail("CONNECTION_LOST");
        if (err.code === "BAD_REQUEST") return;
        if (attempt === 0) await new Promise((r) => setTimeout(r, TURN_RETRY_MS));
      }
    }
    debug("turn_dropped", { speaker: turn.speaker });
  }

  function addTurn(speaker, text) {
    const clean = String(text ?? "").trim();
    // The opening line can arrive before startSession resolves, so "connecting" counts too.
    if (!clean || (phase !== "live" && phase !== "connecting")) return;
    if (speaker === "victim" && refSpeaking) return;
    const t = Math.max(0, Math.round((ctx.now() - t0) / 100) / 10);
    enqueue(async () => {
      // Wait for the call to go live before posting, but drop the line if it never does.
      for (let i = 0; i < 50 && phase === "connecting"; i++) await new Promise((r) => setTimeout(r, 100));
      await postTurn({ speaker, text: clean, t });
    });
  }

  // ---------- connect ----------

  async function connect() {
    let Conversation;
    try {
      ({ Conversation } = await ctx.loadClient());
      if (typeof Conversation?.startSession !== "function") throw new Error("no client");
    } catch {
      fail("SESSION_FAILED");
      throw reported;
    }
    t0 = ctx.now();
    let started;
    try {
      started = await Conversation.startSession({
        conversationToken: session.conversationToken,
        connectionType: "webrtc",
        onMessage: (m) => {
          const role = m?.role ?? (m?.source === "ai" ? "agent" : "user");
          addTurn(role === "agent" ? "scammer" : "victim", m?.message);
        },
        onModeChange: ({ mode } = {}) => {
          agentSpeaking = mode === "speaking";
          if (phase === "live") debug(agentSpeaking ? "scammer_audio_started" : "scammer_audio_stopped");
          idleStatus();
        },
        onDisconnect: () => {
          if (phase === "live" || phase === "connecting") fail("CONNECTION_LOST");
        },
        onError: () => debug("elevenlabs_error"), // never log the message: it may quote the person
      });
    } catch (err) {
      const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError" || /permission/i.test(String(err?.message));
      fail(denied ? "MIC_DENIED" : "UPSTREAM_ERROR");
      throw reported;
    }
    if (phase !== "connecting") {
      // End was pressed (or the call failed) while connecting.
      conv = started;
      stopConversation();
      if (reported) throw reported;
      return;
    }
    conv = started;
    phase = "live";
    setStatus("live");
    applyAudio();
  }

  // ---------- public API (same as VoiceClient, minus start) ----------

  function pauseScammer() {
    if (paused) return;
    paused = true;
    applyAudio();
    idleStatus();
  }

  function resumeScammer() {
    if (!paused) return;
    paused = false;
    applyAudio();
    idleStatus();
  }

  function setRefSpeaking(on) {
    refSpeaking = Boolean(on);
    applyAudio(); // the ref's voice on the speakers must not reach the scammer
    idleStatus();
  }

  /** Plays the unmask line in the scammer's own ElevenLabs voice. Resolves true when it finished. Never rejects. */
  function unmask(text) {
    if (unmaskPromise) return unmaskPromise;
    const line = String(text ?? "").trim();
    if (phase !== "revealed" || !line) return Promise.resolve(false);
    clearTimeout(revealTimer);

    unmaskPromise = new Promise((resolve) => {
      let started = false;
      let done = false;
      const settle = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(startTimer);
        clearTimeout(maxTimer);
        resolve(ok);
      };
      const startTimer = setTimeout(() => !started && settle(false), ctx.unmaskStartMs);
      const maxTimer = setTimeout(() => settle(started), ctx.unmaskMaxMs);

      (async () => {
        const res = await ctx.fetch("/api/voice/unmask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callId, text: line }),
        });
        if (!res.ok || done) return settle(false);
        unmaskUrl = URL.createObjectURL(await res.blob());
        if (done) return;
        const audio = new ctx.Audio(unmaskUrl);
        unmaskAudio = audio;
        audio.onplaying = () => {
          started = true;
          setStatus("scammer_speaking");
        };
        audio.onended = () => settle(true);
        audio.onerror = () => settle(started);
        await audio.play();
        started = true;
      })().catch(() => settle(started));
    }).then((ok) => {
      finish();
      return ok;
    });
    return unmaskPromise;
  }

  function end() {
    if (phase === "revealed") {
      finish(); // the page skipped the unmask: hang up now
      return Promise.resolve();
    }
    if (phase === "connecting") {
      finish();
      return Promise.resolve();
    }
    if (phase !== "live") return Promise.resolve();
    return enqueue(async () => {
      if (phase !== "live") return;
      try {
        const data = await api("/api/voice/end", { callId });
        deliver(data?.actions);
        if (phase === "live") finish(); // already revealed server-side
      } catch (err) {
        fail(err.code === "CALL_NOT_FOUND" ? "CONNECTION_LOST" : "UPSTREAM_ERROR");
      }
    });
  }

  return { connect, pauseScammer, resumeScammer, setRefSpeaking, unmask, end };
}
