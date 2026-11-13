// Owned by Agent F. The voice orb: a living visualizer that doubles as the strike meter (Ref Desk concept).
// Driven by call status, strikes, and (when music is on) the score's loudness.
import { musicLevel } from "../audio/engine.js";

const COL = {
  ring: [160, 140, 255],
  connecting: [160, 140, 255],
  live: [91, 231, 240],
  scammer_speaking: [255, 107, 136],
  ref_speaking: [255, 203, 102],
  unmasking: [255, 107, 136],
  ended: [85, 242, 176],
};
const N = 48;
const COS = [];
const SIN = [];
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2 - Math.PI / 2;
  COS.push(Math.cos(a));
  SIN.push(Math.sin(a));
}

export function createOrb(canvas) {
  const cx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const st = { mode: "ring", strikes: 0, red: false };
  let looping = false;
  let last = 0;

  function draw(t) {
    const W = canvas.width;
    const C = W / 2;
    cx.clearRect(0, 0, W, W);
    const c = COL[st.mode] || COL.live;
    const rgb = `${c[0]},${c[1]},${c[2]}`;
    const talk = st.mode === "scammer_speaking" || st.mode === "ref_speaking" || st.mode === "unmasking";
    const music = reduced ? 0 : musicLevel();
    const g = cx.createRadialGradient(C, C, 10, C, C, 190);
    g.addColorStop(0, `rgba(${rgb},.55)`);
    g.addColorStop(0.45, `rgba(${rgb},.14)`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(C, C, 200, 0, Math.PI * 2);
    cx.fill();
    const base = 96;
    const amp = (talk ? 26 : st.mode === "ring" ? 14 : 8) + music * 18;
    const sp = talk ? 140 : 420;
    cx.beginPath();
    for (let i = 0; i < N; i++) {
      const h = 6 + amp * (0.5 + 0.5 * Math.sin(i * 0.55 + t / sp)) * (0.6 + 0.4 * Math.sin(i * 1.7 - t / 310));
      cx.moveTo(C + COS[i] * base, C + SIN[i] * base);
      cx.lineTo(C + COS[i] * (base + h), C + SIN[i] * (base + h));
    }
    cx.strokeStyle = `rgba(${rgb},.85)`;
    cx.lineWidth = 5;
    cx.lineCap = "round";
    cx.stroke();
    const core = cx.createRadialGradient(C - 18, C - 22, 6, C, C, 78);
    core.addColorStop(0, "rgba(255,255,255,.95)");
    core.addColorStop(0.25, `rgba(${rgb},.85)`);
    core.addColorStop(1, "rgba(10,14,30,.9)");
    cx.fillStyle = core;
    cx.beginPath();
    cx.arc(C, C, 74 + (talk ? 3 * Math.sin(t / 90) : 0), 0, Math.PI * 2);
    cx.fill();
    // Strike meter: three arcs.
    const R = 176;
    const gap = 0.18;
    const seg = (Math.PI * 2 - 3 * gap) / 3;
    for (let i = 0; i < 3; i++) {
      const s = -Math.PI / 2 + gap / 2 + i * (seg + gap);
      const on = i < st.strikes;
      cx.lineCap = "round";
      if (on) {
        cx.lineWidth = 22;
        cx.strokeStyle = st.red ? "rgba(255,51,85,.22)" : "rgba(255,107,136,.22)";
        cx.beginPath();
        cx.arc(C, C, R, s, s + seg);
        cx.stroke();
      }
      cx.lineWidth = 10;
      cx.strokeStyle = on ? (st.red ? "#FF3355" : "#FF6B88") : "rgba(255,255,255,.10)";
      cx.beginPath();
      cx.arc(C, C, R, s, s + seg);
      cx.stroke();
    }
    if (st.mode === "ring") {
      const p = (t / 1400) % 1;
      cx.strokeStyle = `rgba(160,140,255,${1 - p})`;
      cx.lineWidth = 3;
      cx.beginPath();
      cx.arc(C, C, 96 + p * 110, 0, Math.PI * 2);
      cx.stroke();
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
