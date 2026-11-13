// Owned by Agent F. The adaptive tension score (SPEC §0.4, Best Inclusion of Music).
// Layer 0: a soft pad (A minor-ish, ~70 BPM breathing). Strike 1: adds a heartbeat. Strike 2: faster, darker.
// Warning: a brief swell. Good defense: resolves to a major chord for a few bars. Reveal: hard stop.
import { audio, ramp } from "./engine.js";

const ROOT = 110; // A2
const THIRD_MINOR = ROOT * 1.189; // C3
const THIRD_MAJOR = ROOT * 1.26; // C#3
const FIFTH = ROOT * 1.498; // E3

export function createScore() {
  const a = audio();
  if (!a) return { start() {}, setStrikes() {}, warning() {}, goodDefense() {}, stop() {} };
  const { ctx, musicGain } = a;

  let running = false;
  let strikes = 0;
  let nodes = [];
  let beatTimer = null;
  let nextBeat = 0;
  let third = null;
  let filter = null;
  let padGain = null;
  let majorUntil = 0;

  function osc(freq, type, gainNode, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(gainNode);
    o.start();
    nodes.push(o);
    return o;
  }

  function heartbeat(at, strength) {
    for (const [offset, level] of [[0, 1], [0.22, 0.6]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(70, at + offset);
      o.frequency.exponentialRampToValueAtTime(42, at + offset + 0.18);
      g.gain.setValueAtTime(0, at + offset);
      g.gain.linearRampToValueAtTime(0.32 * level * strength, at + offset + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, at + offset + 0.22);
      o.connect(g).connect(musicGain);
      o.start(at + offset);
      o.stop(at + offset + 0.25);
    }
  }

  // Lookahead scheduler: beats are scheduled ~100 ms ahead on the audio clock.
  function schedule() {
    if (!running) return;
    const bpm = strikes >= 2 ? 96 : 72;
    while (nextBeat < ctx.currentTime + 0.12) {
      if (strikes >= 1) heartbeat(nextBeat, strikes >= 2 ? 1 : 0.7);
      nextBeat += 60 / bpm;
    }
    // Pad breathing + harmony.
    const t = ctx.currentTime;
    const darker = strikes >= 2;
    const wantMajor = t < majorUntil;
    third.frequency.setTargetAtTime(wantMajor ? THIRD_MAJOR : THIRD_MINOR, t, 0.4);
    const breath = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * (darker ? 0.4 : 0.25));
    filter.frequency.setTargetAtTime((darker ? 420 : 650) + breath * (wantMajor ? 900 : 350), t, 0.2);
  }

  return {
    start() {
      if (running) return;
      running = true;
      try {
        padGain = ctx.createGain();
        padGain.gain.value = 0;
        filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 600;
        filter.Q.value = 0.7;
        padGain.connect(filter).connect(musicGain);
        osc(ROOT, "triangle", padGain, -6);
        osc(ROOT, "triangle", padGain, 6);
        osc(FIFTH, "sine", padGain);
        third = osc(THIRD_MINOR, "sine", padGain);
        ramp(padGain.gain, 0.09, 2.5);
        nextBeat = ctx.currentTime + 0.1;
        beatTimer = setInterval(schedule, 25);
      } catch {
        running = false;
      }
    },
    setStrikes(n) {
      strikes = n;
    },
    warning() {
      if (!running || !padGain) return;
      const t = ctx.currentTime;
      padGain.gain.cancelScheduledValues(t);
      padGain.gain.setValueAtTime(padGain.gain.value, t);
      padGain.gain.linearRampToValueAtTime(0.16, t + 0.4);
      padGain.gain.linearRampToValueAtTime(0.09, t + 1.6);
    },
    goodDefense() {
      majorUntil = ctx.currentTime + 6;
    },
    stop() {
      if (!running) return;
      running = false;
      clearInterval(beatTimer);
      const t = ctx.currentTime;
      try {
        padGain.gain.cancelScheduledValues(t);
        padGain.gain.setValueAtTime(padGain.gain.value, t);
        padGain.gain.linearRampToValueAtTime(0, t + 0.08);
      } catch {
        /* ignore */
      }
      const old = nodes;
      nodes = [];
      setTimeout(() => old.forEach((o) => { try { o.stop(); } catch { /* ignore */ } }), 150);
    },
  };
}
