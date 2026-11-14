// Owned by Agent F. Plays WireAction.ref: the sound, then the words. Resolves when the ref is done. Never throws.
//   strike / credit: pause the scammer, ref speaking on, sound, speechSynthesis (a voice unlike the scammer's)
//   reveal: sound, then client.unmask(say) in the scammer's own voice; speechSynthesis only as the fallback
import { playSound } from "./audio/sfx.js";
import { duckMusic } from "./audio/engine.js";
import { toast } from "./ui/toast.js";

let chosenVoice;
function refVoice() {
  if (chosenVoice !== undefined) return chosenVoice;
  try {
    const voices = speechSynthesis.getVoices();
    chosenVoice =
      voices.find((v) => /^en/i.test(v.lang) && /google|samantha/i.test(v.name)) ??
      voices.find((v) => /^en/i.test(v.lang)) ??
      null;
    if (!voices.length) chosenVoice = undefined; // not loaded yet; try again next time
    return chosenVoice ?? null;
  } catch {
    return null;
  }
}
try {
  speechSynthesis.addEventListener?.("voiceschanged", () => (chosenVoice = undefined));
} catch {
  /* no speech synthesis */
}

/** Speak with the browser's voice. Resolves on end, or after a length-based timeout. */
export function speak(text) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    try {
      if (!("speechSynthesis" in window)) throw new Error("no tts");
      const u = new SpeechSynthesisUtterance(text);
      const v = refVoice();
      if (v) u.voice = v;
      u.rate = 0.95;
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      setTimeout(finish, Math.max(2500, text.length * 110)); // never cut a long line short
    } catch {
      toast(text, "", Math.max(4000, text.length * 70));
      setTimeout(finish, 1200);
    }
  });
}

/**
 * @param action  WireAction
 * @param client  VoiceClient (real or mock)
 * @param hooks   { onRefSays(text), onUnmask(text) } for captions
 */
export async function play(action, client, hooks = {}) {
  const ref = action?.ref ?? {};
  const isReveal = action?.type === "reveal";
  if (!ref.sound && !ref.say) return;
  try {
    duckMusic(true);
    if (ref.sound || isReveal) {
      client?.pauseScammer?.();
      client?.setRefSpeaking?.(true);
    }
    if (ref.sound) await playSound(ref.sound);
    if (ref.say) {
      if (isReveal) {
        hooks.onUnmask?.(ref.say);
        let ok = false;
        try {
          ok = await client?.unmask?.(ref.say);
        } catch {
          ok = false;
        }
        if (!ok) await speak(ref.say);
      } else {
        hooks.onRefSays?.(ref.say);
        await speak(ref.say);
      }
    }
  } catch {
    /* never throw */
  } finally {
    client?.setRefSpeaking?.(false);
    if (!isReveal) client?.resumeScammer?.();
    duckMusic(false);
  }
}
