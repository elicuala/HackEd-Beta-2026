// Owned by Agent F. The ref's sound identity (SPEC §0.4), synthesized: whistle, red_card, chime, fanfare, ring.
import { audio, prefs } from "./engine.js";

// [frequency, start s, duration s, wave]
const SOUNDS = {
  whistle: [[2100, 0, 0.16, "sine", 18], [2600, 0.2, 0.24, "sine", 22]], // last value: vibrato depth (Hz)
  red_card: [[220, 0, 0.2, "triangle"], [165, 0.16, 0.6, "triangle"], [110, 0.16, 0.6, "sine"]],
  chime: [[784, 0, 0.3, "sine"], [1047, 0.18, 0.5, "sine"]],
  fanfare: [[523, 0, 0.22, "triangle"], [659, 0.16, 0.22, "triangle"], [784, 0.32, 0.22, "triangle"], [1047, 0.48, 0.9, "triangle"], [784, 0.48, 0.9, "sine"]],
};

function note(a, [freq, start, dur, wave = "sine", vibrato = 0], at, level = 0.18) {
  const { ctx, sfx } = a;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = wave;
  o.frequency.value = freq;
  if (vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 28;
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(at + start);
    lfo.stop(at + start + dur + 0.05);
  }
  const s = at + start;
  g.gain.setValueAtTime(0, s);
  g.gain.linearRampToValueAtTime(level, s + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, s + dur);
  o.connect(g).connect(sfx);
  o.start(s);
  o.stop(s + dur + 0.05);
}

/** Play a named sound. Resolves when it's done (immediately if sound is off or unavailable). */
export function playSound(name) {
  const notes = SOUNDS[name];
  const a = prefs.sound ? audio() : null;
  if (!notes || !a) return Promise.resolve();
  try {
    const at = a.ctx.currentTime + 0.02;
    for (const n of notes) note(a, n, at);
    const ms = Math.max(...notes.map(([, st, d]) => st + d)) * 1000 + 60;
    return new Promise((r) => setTimeout(r, ms));
  } catch {
    return Promise.resolve();
  }
}

/** A soft two-tone ringtone that repeats until stopped. Returns stop(). */
export function ring() {
  const a = prefs.sound ? audio() : null;
  if (!a) return () => {};
  const once = () => {
    try {
      const at = a.ctx.currentTime + 0.02;
      for (let i = 0; i < 2; i++) {
        note(a, [659, i * 0.42, 0.36, "sine"], at, 0.1);
        note(a, [523, i * 0.42 + 0.18, 0.3, "sine"], at, 0.08);
      }
    } catch {
      /* ignore */
    }
  };
  once();
  const timer = setInterval(once, 2400);
  return () => clearInterval(timer);
}
