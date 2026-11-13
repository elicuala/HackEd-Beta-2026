// Owned by Agent F. The voice orb: a living visualizer that doubles as the strike meter.
// Colours come from the theme's iOS system colours (CSS variables), re-read when the theme changes.
import { musicLevel } from "../audio/engine.js";

const MODE_VAR = {
  ring: "--indigo",
  connecting: "--indigo",
  live: "--blue",
  scammer_speaking: "--red",
  ref_speaking: "--orange",
  unmasking: "--indigo",
  ended: "--green",
};
const N = 48;
const COS = [];
const SIN = [];
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2 - Math.PI / 2;
  COS.push(Math.cos(a));
  SIN.push(Math.sin(a));
}

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const colors = {};
  for (const [mode, name] of Object.entries(MODE_VAR)) colors[mode] = v(name, "#007aff");
  return {
    colors,
    red: v("--red", "#ff3b30"),
    track: v("--fill-strong", "rgba(0,0,0,.08)"),
    core: v("--orb-core", "#ffffff"),
  };
}

export function createOrb(canvas) {
  const cx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const st = { mode: "ring", strikes: 0, red: false };
  let theme = readTheme();
  let looping = false;
  let last = 0;

  new MutationObserver(() => {
    theme = readTheme();
    if (!looping) draw(800);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  function draw(t) {
    const W = canvas.width;
    const C = W / 2;
    const col = theme.colors[st.mode] ?? theme.colors.live;
    const talk = st.mode === "scammer_speaking" || st.mode === "ref_speaking" || st.mode === "unmasking";
    const music = reduced ? 0 : musicLevel();
    cx.clearRect(0, 0, W, W);

    // Soft halo.
    cx.globalAlpha = 0.16;
    cx.fillStyle = col;
    cx.beginPath();
    cx.arc(C, C, 150 + (talk ? 6 * Math.sin(t / 120) : 0), 0, Math.PI * 2);
    cx.fill();
    cx.globalAlpha = 1;

    // Voice bars around the core.
    const base = 92;
    const amp = (talk ? 26 : st.mode === "ring" ? 14 : 8) + music * 18;
    const sp = talk ? 140 : 420;
    cx.beginPath();
    for (let i = 0; i < N; i++) {
      const h = 6 + amp * (0.5 + 0.5 * Math.sin(i * 0.55 + t / sp)) * (0.6 + 0.4 * Math.sin(i * 1.7 - t / 310));
      cx.moveTo(C + COS[i] * base, C + SIN[i] * base);
      cx.lineTo(C + COS[i] * (base + h), C + SIN[i] * (base + h));
    }
    cx.strokeStyle = col;
    cx.lineWidth = 5;
    cx.lineCap = "round";
    cx.stroke();

    // Core: the system colour, lit from the top-left.
    const r = 72 + (talk ? 3 * Math.sin(t / 90) : 0);
    cx.fillStyle = col;
    cx.beginPath();
    cx.arc(C, C, r, 0, Math.PI * 2);
    cx.fill();
    const shine = cx.createRadialGradient(C - 22, C - 26, 4, C, C, r);
    shine.addColorStop(0, "rgba(255,255,255,.75)");
    shine.addColorStop(0.45, "rgba(255,255,255,.08)");
    shine.addColorStop(1, "rgba(0,0,0,.18)");
    cx.fillStyle = shine;
    cx.beginPath();
    cx.arc(C, C, r, 0, Math.PI * 2);
    cx.fill();

    // Strike meter: three arcs.
    const R = 176;
    const gap = 0.18;
    const seg = (Math.PI * 2 - 3 * gap) / 3;
    cx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const s = -Math.PI / 2 + gap / 2 + i * (seg + gap);
      const on = i < st.strikes;
      cx.lineWidth = on ? 12 : 10;
      cx.strokeStyle = on ? theme.red : theme.track;
      cx.beginPath();
      cx.arc(C, C, R, s, s + seg);
      cx.stroke();
    }

    // Ringing: a ripple.
    if (st.mode === "ring") {
      const p = (t / 1400) % 1;
      cx.globalAlpha = 1 - p;
      cx.strokeStyle = col;
      cx.lineWidth = 3;
      cx.beginPath();
      cx.arc(C, C, 92 + p * 110, 0, Math.PI * 2);
      cx.stroke();
      cx.globalAlpha = 1;
    }
  }

  function loop(t) {
    if (!looping) return;
    if (!canvas.isConnected || canvas.closest("[hidden]")) {
      looping = false;
      return;
    }
    if (t - last >= 33) {
      last = t;
      draw(t);
    }
    requestAnimationFrame(loop);
  }

  function kick() {
    if (reduced) return draw(800);
    if (!looping) {
      looping = true;
      requestAnimationFrame(loop);
    }
  }

  return {
    set(patch) {
      Object.assign(st, patch);
      kick();
    },
    start: kick,
    stop() {
      looping = false;
    },
  };
}
