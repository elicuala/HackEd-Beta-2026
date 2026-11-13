// Owned by Agent F. One shared AudioContext: master → (sfx bus, music bus → analyser). Never throws.
const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "on";
  } catch {
    return fallback;
  }
};
const write = (key, on) => {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    /* private mode */
  }
};

export const prefs = {
  get sound() {
    return read("scamDrill.sound", true);
  },
  set sound(on) {
    write("scamDrill.sound", on);
  },
  get music() {
    return read("scamDrill.music", true);
  },
  set music(on) {
    write("scamDrill.music", on);
    if (state.musicGain) ramp(state.musicGain.gain, on ? state.musicLevel : 0, 0.2);
  },
};

const state = { ctx: null, master: null, sfx: null, musicGain: null, analyser: null, musicLevel: 1 };

/** Lazily create the context. Call unlock() inside a click so browsers allow sound. */
export function audio() {
  if (state.ctx) return state;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    const sfx = ctx.createGain();
    sfx.connect(master);
    const musicGain = ctx.createGain();
    musicGain.gain.value = prefs.music ? 1 : 0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    musicGain.connect(analyser);
    analyser.connect(master);
    Object.assign(state, { ctx, master, sfx, musicGain, analyser });
    return state;
  } catch {
    return null;
  }
}

export function unlock() {
  const a = audio();
  try {
    if (a?.ctx.state === "suspended") a.ctx.resume();
  } catch {
    /* ignore */
  }
  return a;
}

export function ramp(param, value, seconds = 0.15) {
  if (!state.ctx) return;
  const t = state.ctx.currentTime;
  try {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + seconds);
  } catch {
    /* ignore */
  }
}

/** Duck the music under voices (to ~10%), or bring it back. */
export function duckMusic(on) {
  state.musicLevel = on ? 0.1 : 1;
  if (state.musicGain && prefs.music) ramp(state.musicGain.gain, state.musicLevel, on ? 0.12 : 0.6);
}

/** 0..1 loudness of the music bus right now (for the orb). */
export function musicLevel() {
  const an = state.analyser;
  if (!an) return 0;
  const buf = new Uint8Array(an.frequencyBinCount);
  an.getByteFrequencyData(buf);
  let sum = 0;
  for (const v of buf) sum += v;
  return Math.min(1, sum / buf.length / 90);
}
