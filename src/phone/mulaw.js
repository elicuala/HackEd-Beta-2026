// Owned by Agent B. G.711 μ-law (Twilio's phone audio) and the ref's sounds as phone tones.
export const SAMPLE_RATE = 8000;
const BIAS = 0x84;
const CLIP = 32635;

/** One 16-bit PCM sample → one μ-law byte. Silence (0) → 0xFF. */
export function linearToMulaw(sample) {
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

// [frequency Hz, start s, duration s] per note. Same shapes as the browser sounds, kept under 1 s.
const NOTES = {
  whistle: [[2100, 0, 0.16], [2600, 0.2, 0.22]],
  red_card: [[220, 0, 0.18], [165, 0.16, 0.5]],
  chime: [[784, 0, 0.25], [1047, 0.18, 0.4]],
  fanfare: [[523, 0, 0.18], [659, 0.15, 0.18], [784, 0.3, 0.18], [1047, 0.45, 0.45]],
};

/** A ref sound as μ-law bytes (8 kHz mono), or null for an unknown sound. */
export function toneMulaw(sound) {
  const notes = NOTES[sound];
  if (!notes) return null;
  const seconds = Math.max(...notes.map(([, st, d]) => st + d)) + 0.05;
  const n = Math.round(seconds * SAMPLE_RATE);
  const pcm = new Float64Array(n);
  for (const [freq, start, dur] of notes) {
    const from = Math.round(start * SAMPLE_RATE);
    const len = Math.round(dur * SAMPLE_RATE);
    for (let i = 0; i < len && from + i < n; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.min(1, t / 0.02) * Math.exp(-3 * (t / dur)); // fast attack, gentle decay
      pcm[from + i] += Math.sin(2 * Math.PI * freq * t) * env * 0.35 * 32767;
    }
  }
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) out[i] = linearToMulaw(pcm[i]);
  return out;
}

/** Split μ-law bytes into 20 ms (160-byte) base64 frames for Twilio media messages. */
export function toFrames(buf, frameBytes = 160) {
  const frames = [];
  for (let i = 0; i < buf.length; i += frameBytes) frames.push(buf.subarray(i, i + frameBytes).toString("base64"));
  return frames;
}
