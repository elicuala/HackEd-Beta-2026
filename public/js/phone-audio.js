// Owned by Agent F. The browser side of "Take over call": the mic becomes 20 ms μ-law frames (8 kHz, what the
// phone speaks) and the phone's frames play through the speaker. Nothing here is recorded or kept.
export const MULAW_RATE = 8000;
const BIAS = 0x84;

/** One μ-law byte → one 16-bit PCM sample (G.711). */
export function mulawToLinear(byte) {
  const u = ~byte & 0xff;
  let t = ((u & 0x0f) << 3) + BIAS;
  t <<= (u & 0x70) >> 4;
  return u & 0x80 ? BIAS - t : t - BIAS;
}

/** base64 μ-law frame → Float32 samples at 8 kHz. */
export function decodeFrame(b64) {
  let bin = "";
  try {
    bin = atob(b64);
  } catch {
    return new Float32Array(0);
  }
  const out = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = mulawToLinear(bin.charCodeAt(i)) / 32768;
  return out;
}

/** μ-law bytes → base64 (the wire format both ways). */
export function encodeFrame(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * Opens the mic and the speaker path.
 *   onFrame(b64)  gets each 20 ms μ-law frame from the mic
 *   play(b64)     queues a frame from the phone (played in order, with a small jitter buffer)
 *   close()       stops the mic and the audio
 * Throws { code: "MIC_DENIED" } if the browser refuses the microphone.
 */
export async function openLine({ onFrame, getUserMedia = (c) => navigator.mediaDevices.getUserMedia(c) }) {
  let stream;
  try {
    stream = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    throw { code: "MIC_DENIED", message: "Microphone blocked" };
  }
  const ctx = new AudioContext();
  try {
    await ctx.resume();
    await ctx.audioWorklet.addModule("/js/audio/mulaw-capture.worklet.js");
  } catch {
    for (const t of stream.getTracks()) t.stop();
    ctx.close().catch(() => {});
    throw { code: "TAKEOVER_UNSUPPORTED", message: "AudioWorklet unavailable" };
  }
  const src = ctx.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(ctx, "mulaw-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  capture.port.onmessage = (e) => onFrame(encodeFrame(new Uint8Array(e.data)));
  src.connect(capture);
  capture.connect(ctx.destination); // the worklet outputs silence; being connected keeps it running

  let nextAt = 0;
  const play = (b64) => {
    const pcm = decodeFrame(b64);
    if (!pcm.length) return;
    const buf = ctx.createBuffer(1, pcm.length, MULAW_RATE); // 8 kHz buffers: the context resamples on playback
    buf.copyToChannel(pcm, 0);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    const at = Math.max(nextAt, ctx.currentTime + 0.04); // ~2 frames of jitter buffer
    node.start(at);
    nextAt = at + buf.duration;
  };
  const close = () => {
    try {
      capture.port.onmessage = null;
      src.disconnect();
      capture.disconnect();
    } catch {
      /* ignore */
    }
    for (const t of stream.getTracks()) t.stop();
    ctx.close().catch(() => {});
  };
  return { play, close };
}
