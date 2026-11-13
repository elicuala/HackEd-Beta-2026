// Owned by Agent F. "Replay your drill": the report timeline as a ~10 s melody.
// Good moves step UP a major scale, warnings hold a neutral tone, strikes step DOWN, a red card ends on a low sting.
import { audio, prefs } from "./engine.js";

const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
const hz = (semi) => 261.63 * 2 ** (semi / 12); // from middle C

function tone(a, freq, at, dur, wave, level) {
  const o = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  o.type = wave;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  o.connect(g).connect(a.sfx);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** Pitches and times for the events (pure, so it's easy to reason about). */
export function melody(events, total = 9) {
  const list = Array.isArray(events) ? events : [];
  const maxT = Math.max(1, ...list.map((e) => Number(e.t) || 0));
  let step = 4; // start mid-scale
  let lastAt = -1;
  return list.map((e) => {
    let at = 0.4 + ((Number(e.t) || 0) / maxT) * total;
    if (at - lastAt < 0.45) at = lastAt + 0.45; // keep notes apart
    lastAt = at;
    if (e.tier === "good_defense") step = Math.min(MAJOR.length - 1, step + 1);
    else if (e.tier === "strike") step = Math.max(0, step - 1);
    const semi = e.tier === "autofail" ? -12 : MAJOR[step] - (e.tier === "strike" ? 1 : 0); // strikes sound flat
    return { at, freq: hz(semi), tier: e.tier };
  });
}

/**
 * Play the replay. onNote(i) fires as each event's note plays (to highlight it). Returns { stop, done }.
 */
export function replay(events, { onNote = () => {}, onDone = () => {} } = {}) {
  const a = audio();
  const notes = melody(events);
  const timers = [];
  let stopped = false;
  const finish = () => {
    if (!stopped) {
      stopped = true;
      onDone();
    }
  };
  try {
    if (a?.ctx.state === "suspended") a.ctx.resume();
  } catch {
    /* ignore */
  }
  const start = a ? a.ctx.currentTime + 0.05 : 0;
  notes.forEach((n, i) => {
    if (a && prefs.sound) {
      const wave = n.tier === "warning" ? "triangle" : n.tier === "autofail" ? "sawtooth" : "sine";
      const dur = n.tier === "autofail" ? 1.2 : 0.55;
      tone(a, n.freq, start + n.at, dur, wave, n.tier === "autofail" ? 0.08 : 0.16);
      if (n.tier === "good_defense") tone(a, n.freq * 1.5, start + n.at, dur, "sine", 0.06); // a bright fifth
    }
    timers.push(setTimeout(() => !stopped && onNote(i), n.at * 1000 + 50));
  });
  const endMs = ((notes.at(-1)?.at ?? 0) + 1.3) * 1000;
  timers.push(setTimeout(finish, endMs));
  return {
    stop() {
      timers.forEach(clearTimeout);
      finish();
    },
  };
}
