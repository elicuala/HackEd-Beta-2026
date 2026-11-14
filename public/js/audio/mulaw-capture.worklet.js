// Owned by Agent F. AudioWorklet for "Take over call": takes the mic at the context's rate, averages it down to
// 8 kHz, μ-law encodes it (G.711, same as src/phone/mulaw.js), and posts 20 ms frames (160 bytes) to the page.
const OUT_RATE = 8000;
const FRAME = 160;
const BIAS = 0x84;
const CLIP = 32635;

function linearToMulaw(sample) {
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

class MulawCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / OUT_RATE; // input samples per output sample (6 at 48 kHz)
    this.t = 0;
    this.acc = 0;
    this.cnt = 0;
    this.frame = new Uint8Array(FRAME);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      // Box-filter decimation: average every `step` input samples into one output sample.
      this.acc += ch[i];
      this.cnt++;
      this.t++;
      if (this.t >= this.step) {
        this.t -= this.step;
        this.frame[this.n++] = linearToMulaw((this.acc / this.cnt) * 32767);
        this.acc = 0;
        this.cnt = 0;
        if (this.n === FRAME) {
          this.port.postMessage(this.frame.buffer.slice(0));
          this.n = 0;
        }
      }
    }
    return true; // the output stays silent (nothing is written to outputs)
  }
}

registerProcessor("mulaw-capture", MulawCapture);
