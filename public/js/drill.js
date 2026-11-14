// Owned by Agent F. The drill page: choose → ringing → (declined | connecting → live → unmasking → report).
// Uses the real voice client by default; ?mock=1 / ?mock=pass (or "Play the demo call") uses the scripted mock.
// ?judge=1 opens the Ref's view (for demos).
import { api, friendly } from "./api.js";
import { scenarioIcon, STATUS, eventName, fmt } from "./content.js";
import { createFeed, createRefsView, setMeter } from "./ui/feed.js";
import { play as playRef } from "./ref-player.js";
import { prefs, unlock, duckMusic } from "./audio/engine.js";
import { playSound, ring } from "./audio/sfx.js";
import { createScore } from "./audio/score.js";
import { renderReport } from "./report-view.js";
import { toast } from "./ui/toast.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let useMock = params.has("mock");
let scenarios = [];
let scen = null;
let client = null;
let run = 0;
let strikes = 0;
let red = false;
let t0 = 0;
let clockTimer = null;
let stopRing = () => {};
let score = null;
let queue = Promise.resolve();
let errorShown = false;

/** Run a DOM change as a View Transition (morphing cards), or directly when unsupported / reduced motion. */
function vt(update) {
  if (!document.startViewTransition || reduced) return update();
  const t = document.startViewTransition(update);
  for (const p of [t.ready, t.finished, t.updateCallbackDone]) p.catch(() => {});
}

const STEPS = ["pick", "answer", "talk", "learn"];
function setStep(name) {
  const at = STEPS.indexOf(name);
  document.querySelectorAll("#steps li").forEach((li) => {
    const i = STEPS.indexOf(li.dataset.step);
    if (i === at) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
    li.classList.toggle("done", i < at);
  });
}

/** A brief glow around the screen edge: red for strikes, green for good moves. */
function flash(kind) {
  const f = $("flash");
  if (!f || reduced) return;
  f.classList.remove("go-flash", "good");
  void f.offsetWidth; // restart the animation
  f.classList.add("go-flash");
  if (kind === "good") f.classList.add("good");
}

const feed = createFeed($("log"));
const rv = createRefsView($("rv"));
$("rvBox").open = params.has("judge");
$("demoBadge").hidden = !useMock;

// ---------- setup ----------

$("snd").checked = prefs.sound;
$("music").checked = prefs.music;
$("snd").onchange = (e) => (prefs.sound = e.target.checked);
$("music").onchange = (e) => (prefs.music = e.target.checked);
$("consent").onchange = (e) => ($("start").disabled = !e.target.checked || !scen);

async function loadScenarios() {
  try {
    scenarios = await api.scenarios();
  } catch (err) {
    $("scenCount").textContent = "Unavailable";
    return showError(err);
  }
  $("scenCount").textContent = `${scenarios.length} scenarios`;
  const box = $("scen");
  box.replaceChildren();
  for (const s of scenarios) {
    const label = document.createElement("label");
    label.className = "opt";
    const input = document.createElement("input");
    Object.assign(input, { type: "radio", name: "scen", value: s.id, id: `sc-${s.id}` });
    const ico = document.createElement("span");
    ico.className = "ico";
    ico.setAttribute("aria-hidden", "true");
    ico.innerHTML = `<svg viewBox="0 0 24 24">${scenarioIcon(s.id)}</svg>`; // static icons from content.js
    const b = document.createElement("b");
    b.textContent = s.title;
    const blurb = document.createElement("span");
    blurb.textContent = s.blurb;
    label.append(input, ico, b, blurb);
    box.append(label);
  }
  const first = box.querySelector('input[value="cra"]') ?? box.querySelector("input");
  if (first) {
    first.checked = true;
    scen = first.value;
  }
  box.onchange = (e) => (scen = e.target.value);
  $("start").disabled = !$("consent").checked || !scen;
}

const scenarioTitle = () => scenarios.find((s) => s.id === scen)?.title ?? "Practice call";

// ---------- view helpers ----------

function setStatus(s) {
  $("pill").dataset.s = s;
  $("pillText").textContent = STATUS[s] ?? s;
  $("phoneIcon").dataset.s = s;
}

/** "1 of 3 pushbacks": at the limit the caller gives up and the mask comes off. */
function pushMeter(count = 0, limit = 3) {
  const el = $("pushes");
  el.querySelectorAll("i").forEach((i, n) => i.classList.toggle("on", n < count));
  el.querySelector("span").textContent = `${count} of ${limit} pushbacks`;
}

function meter() {
  setMeter($("strikes"), strikes, red);
  $("phoneIcon").classList.toggle("red", red);
}

function resetCall() {
  run++;
  queue = Promise.resolve();
  errorShown = false;
  $("pushes").dataset.count = 0;
  pushMeter(0);
  strikes = 0;
  red = false;
  t0 = 0;
  clearInterval(clockTimer);
  score?.stop();
  score = null;
  feed.clear("Your practice call will appear here as it happens.");
  rv.clear("Each call the ref makes appears here, with where it came from and how sure it was.");
  meter();
  $("report").hidden = true;
  $("errorBox").hidden = true;
  $("caption").hidden = true;
  $("stage").classList.remove("unmasked");
  $("refText").textContent = "Listening.";
  $("whoLbl").textContent = "Unknown caller";
  $("end").hidden = false;
  $("end").disabled = false;
  $("stopHint").hidden = false;
}

function showPanel(name) {
  $("pickPanel").hidden = name !== "pick";
  $("declinedPanel").hidden = name !== "declined";
  $("callPanel").hidden = name !== "call";
}

function stopCallAudio() {
  stopRing();
  stopRing = () => {};
  clearInterval(clockTimer);
  score?.stop();
  duckMusic(false);
}

function showError(err) {
  if (errorShown) return;
  errorShown = true;
  stopCallAudio();
  vt(() => {
    setStatus("idle");
    setStep("pick");
    showPanel("pick");
    $("errorText").textContent = friendly(err);
    $("playDemo").hidden = useMock;
    $("errorBox").hidden = false;
    $("errorBox").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    $("retry").focus();
  });
}

// ---------- ringing / declined ----------

function ringNow() {
  vt(ringNowNow);
}
function ringNowNow() {
  document.body.dataset.hascall = "1"; // the conversation section appears in the panel
  resetCall();
  setStep("answer");
  showPanel("call");
  $("ringBtns").hidden = false;
  $("liveBits").hidden = true;
  $("callerLbl").textContent = "Incoming call";
  $("callScen").textContent = scenarioTitle();
  $("convMeta").textContent = scenarioTitle();
  setStatus("ringing");
  feed.sys("INCOMING CALL");
  unlock();
  stopRing = ring();
  $("answer").focus({ preventScroll: true });
  $("callPanel").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

$("start").onclick = ringNow;
$("decline").onclick = () => {
  stopCallAudio();
  playSound("chime");
  flash("good");
  vt(() => {
    setStatus("idle");
    feed.sys("CALL DECLINED");
    showPanel("declined");
    $("answerAnyway").focus();
  });
};
$("answerAnyway").onclick = ringNow;
$("backToPick").onclick = () =>
  vt(() => {
    setStep("pick");
    showPanel("pick");
    $("scen").querySelector("input:checked")?.focus();
  });
$("retry").onclick = () => {
  $("errorBox").hidden = true;
  ringNow();
};
$("playDemo").onclick = () => {
  useMock = true;
  $("demoBadge").hidden = false;
  $("errorBox").hidden = true;
  ringNow();
};

// ---------- the call ----------

async function loadClient() {
  if (!useMock) {
    try {
      return await import("/js/voice-client.js");
    } catch {
      useMock = true;
      $("demoBadge").hidden = false;
    }
  }
  return import("/js/voice-client.mock.js");
}

$("answer").onclick = async () => {
  const my = run;
  stopRing();
  unlock(); // inside the click: lets the browser play sound
  setStep("talk");
  $("ringBtns").hidden = true;
  $("liveBits").hidden = false;
  $("callerLbl").textContent = "Connecting";
  $("clock").textContent = "0:00";
  setStatus("connecting");

  const { createVoiceClient } = await loadClient();
  if (my !== run) return;
  $("pushes").hidden = useMock; // the scripted demo has no server-side pushback counter
  // The mic permission prompt is easy to miss: if we're still connecting after a moment, say what we're waiting for.
  const micHint = setTimeout(() => {
    if (my === run && $("pill").dataset.s === "connecting" && !useMock) {
      $("refText").textContent = "Waiting for your microphone. Click Allow in the browser's prompt near the address bar.";
    }
  }, 2500);
  client = createVoiceClient({
    onStatus: (s) => my === run && onStatus(s),
    onTurn: (t) => my === run && feed.turn(t),
    onActions: (actions) => {
      if (my !== run) return;
      queue = queue.then(() => handleActions(actions, my)).catch(() => {});
    },
    onError: (err) => my === run && showError(err),
    onPushbacks: ({ count, limit }) => {
      if (my !== run) return;
      const before = Number($("pushes").dataset.count ?? 0);
      $("pushes").dataset.count = count;
      pushMeter(count, limit);
      if (count > before && count < limit) toast(`Pushback ${count} of ${limit}. Keep it up.`, "good");
    },
  });
  try {
    await client.start(scen);
  } catch {
    /* onError already showed a friendly message */
  } finally {
    clearTimeout(micHint);
  }
};

$("end").onclick = () => {
  $("end").disabled = true;
  client?.end();
};

function onStatus(s) {
  if (s === "live" && !t0) {
    t0 = performance.now();
    clockTimer = setInterval(() => ($("clock").textContent = fmt((performance.now() - t0) / 1000)), 500);
    $("callerLbl").textContent = "On the call";
    $("refText").textContent = "Listening.";
    feed.sys("CALL CONNECTED");
    score = createScore();
    score.start();
    $("end").focus();
  }
  if (s === "scammer_speaking") duckMusic(true);
  else if (s === "live") duckMusic(false);
  if (s === "ended") {
    clearInterval(clockTimer);
    score?.stop();
  }
  // While the caller is dropping the act, the pill stays on "Dropping the act": reveal() sets "ended" itself
  // once the line has been said (the voice client may already have hung up underneath).
  if ($("pill").dataset.s !== "unmasking") setStatus(s);
}

async function handleActions(actions, my) {
  for (const a of actions) {
    if (my !== run) return;
    const e = a.event;
    // The ref stays quiet on the call (no whistle, no voice) so the conversation flows, but every call it makes
    // shows on screen as it happens: the strike meter, the ref's line, the conversation, toasts and the Ref's view.
    if (a.type === "strike_called") {
      strikes = a.strikeNumber ?? strikes + 1;
      meter();
      if (e) rv.add(e);
      feed.action({ ...a, say: a.ref?.say });
      $("refText").textContent = a.ref?.say ?? `Strike ${strikes}: ${e ? eventName(e).toLowerCase() : "careful"}.`;
      toast(`Strike ${strikes}${e ? `: ${eventName(e).toLowerCase()}` : ""}.`, "warn");
      score?.setStrikes(strikes);
      flash("bad");
    } else if (a.type === "warning_shown") {
      if (e) rv.add(e);
      feed.action(a);
      $("refText").textContent = `Careful: ${e ? eventName(e).toLowerCase() : "watch out"}.`;
      toast(`Careful: ${e ? eventName(e).toLowerCase() : "watch out"}.`, "warn");
      score?.warning();
    } else if (a.type === "credit_shown") {
      if (e) rv.add(e);
      feed.action(a);
      $("refText").textContent = `Good move: ${e ? eventName(e).toLowerCase() : "nice"}.`;
      toast(`Good move: ${e ? eventName(e).toLowerCase() : "nice"}.`, "good");
      score?.goodDefense();
      flash("good");
    } else if (a.type === "reveal") {
      await reveal(a, my);
    }
  }
}

async function reveal(a, my) {
  const autofail = a.events?.findLast?.((x) => x.tier === "autofail");
  if (a.outcome === "failed_autofail") {
    red = true;
    strikes = 3;
    meter();
    if (autofail) rv.add(autofail);
    feed.action(a);
    $("refText").textContent = `Red card. ${autofail ? eventName(autofail) + "." : ""}`;
    flash("bad");
  } else if (a.outcome === "passed") {
    flash("good");
  }
  score?.stop();
  // The drill is over. First the caller says so, in its own voice: "This was a Loki drill..." and the trick it
  // used. Only then does the call end and the report card appear (the same line is on the report too).
  try {
    speechSynthesis.cancel();
  } catch {
    /* no speech synthesis */
  }
  setStatus("unmasking");
  $("callerLbl").textContent = "The mask comes off";
  $("whoLbl").textContent = "This was a Loki drill";
  $("stage").classList.add("unmasked");
  $("end").hidden = true;
  $("stopHint").hidden = true;
  if (a.ref?.say) {
    $("captionText").textContent = a.ref.say;
    $("caption").hidden = false;
    feed.unmask(a.ref.say);
  }
  // Plays the sting, then the unmask in the caller's voice (the browser's voice if that fails). Never throws.
  await playRef(a, client);
  if (my !== run) return;
  client?.end?.(); // hang up, now that the line has been said
  duckMusic(false);
  try {
    sessionStorage.setItem("scamDrill.result", JSON.stringify(a));
  } catch {
    /* private mode */
  }
  clearInterval(clockTimer);
  setStatus("ended");
  feed.sys("CALL ENDED");
  const host = $("report");
  vt(() => {
    setStep("learn");
    showPanel("pick");
    host.hidden = false;
    renderReport(host, a, {
      onAgain: () =>
        vt(() => {
          host.hidden = true;
          setStatus("idle");
          setStep("pick");
          $("scen").querySelector("input:checked")?.focus();
          scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
        }),
    });
    host.querySelector("h2")?.setAttribute("tabindex", "-1");
    host.querySelector("h2")?.focus({ preventScroll: true });
  });
  setTimeout(() => host.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }), reduced ? 0 : 450);
}

setStatus("idle");
loadScenarios();
