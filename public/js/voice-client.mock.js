// Owned by Agent F. The demo voice client: the same interface as public/js/voice-client.js (SPEC §5.7),
// playing a scripted call (fixtures generated from the real pipeline). No mic, no network beyond the fixture.
// Used with ?mock=1 / ?mock=pass, or as the fallback when the real voice service isn't available.
// The scammer's lines are spoken with the browser's voice so the demo is audible.

const pickFixture = (scenarioId) => {
  const mode = new URLSearchParams(location.search).get("mock");
  if (mode === "pass") return "mock-call-pass";
  return { bank_fraud: "mock-bank_fraud" }[scenarioId] ?? "mock-call-fail";
};

function scammerVoice() {
  try {
    const voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    // Prefer a different voice from the ref's (the ref prefers Google/Samantha).
    return voices.find((v) => !/google|samantha/i.test(v.name)) ?? voices[1] ?? voices[0] ?? null;
  } catch {
    return null;
  }
}

export function createVoiceClient(handlers = {}) {
  const call = (name, arg) => {
    try {
      handlers[name]?.(arg);
    } catch {
      /* UI bugs must not kill the call */
    }
  };
  let phase = "idle"; // idle → live → revealed → ended
  let paused = false;
  let refSpeaking = false;
  let events = [];
  let script = null;
  let wake = null;
  let endTimer = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitWhileHeld = async () => {
    while ((paused || refSpeaking) && phase === "live") await new Promise((r) => (wake = r));
  };
  const nudge = () => {
    wake?.();
    wake = null;
  };

  function say(text) {
    return new Promise((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        const v = scammerVoice();
        if (v) u.voice = v;
        u.rate = 1.05;
        u.pitch = 0.85;
        u.onend = resolve;
        u.onerror = resolve;
        speechSynthesis.speak(u);
        setTimeout(resolve, Math.max(1500, text.length * 75));
      } catch {
        setTimeout(resolve, 800);
      }
    });
  }

  function finish() {
    if (phase === "ended") return;
    phase = "ended";
    clearTimeout(endTimer);
    nudge();
    call("onStatus", "ended");
  }

  function deliver(actions) {
    for (const a of actions) if (a.event) events.push(a.event);
    if (actions.some((a) => a.type === "reveal")) {
      phase = "revealed";
      endTimer = setTimeout(finish, 15000);
    }
    call("onActions", actions);
  }

  async function run() {
    for (const step of script.steps) {
      if (phase !== "live") return;
      await sleep(step.delayMs);
      await waitWhileHeld();
      if (phase !== "live") return;
      if (step.kind === "status") {
        if (step.data !== "live" || !refSpeaking) call("onStatus", step.data);
      } else if (step.kind === "turn") {
        call("onTurn", step.data);
        if (step.data.speaker === "scammer") await say(step.data.text);
      } else if (step.kind === "actions") {
        deliver(step.data);
      }
    }
  }

  return {
    async start(scenarioId) {
      if (phase !== "idle") throw { code: "SESSION_FAILED", message: "Already started" };
      call("onStatus", "connecting");
      try {
        const res = await fetch(`/fixtures/${pickFixture(scenarioId)}.json`);
        if (!res.ok) throw new Error("fixture");
        script = await res.json();
      } catch {
        const err = { code: "SESSION_FAILED", message: "The demo call couldn't load." };
        call("onError", err);
        finish();
        throw err;
      }
      phase = "live";
      run();
      return { callId: "mock-call" };
    },
    pauseScammer() {
      // Cut the scammer off (the browser has one speech queue, and the ref needs it next).
      paused = true;
      try {
        speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    },
    resumeScammer() {
      paused = false;
      nudge();
    },
    setRefSpeaking(on) {
      refSpeaking = Boolean(on);
      if (phase === "live") call("onStatus", refSpeaking ? "ref_speaking" : "live");
      nudge();
    },
    async unmask() {
      // The demo has no AI voice: the ref-player falls back to speechSynthesis.
      clearTimeout(endTimer);
      setTimeout(finish, 50);
      return false;
    },
    async end() {
      if (phase !== "live") return;
      try {
        speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      const reveal = { ...script.endReveal, events: events.slice(), endedAt: new Date().toISOString() };
      deliver([reveal]);
    },
  };
}
