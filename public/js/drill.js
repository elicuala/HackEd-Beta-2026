// Owned by Agent F. The drill page: choose → ringing → (declined | connecting → live → unmasking → report).
// Uses the real voice client by default; ?mock=1 / ?mock=pass (or "Play the demo call") uses the scripted mock.
// ?judge=1 opens the Ref's view (for demos).
import { api, friendly } from "./api.js";
import { scenarioIcon, STATUS, eventName, fmt } from "./content.js";
import { createFeed, createRefsView, setMeter } from "./ui/feed.js";
import { createOrb } from "./ui/orb.js";
import { play as playRef } from "./ref-player.js";
import { prefs, unlock, duckMusic } from "./audio/engine.js";
import { playSound, ring } from "./audio/sfx.js";
import { createScore } from "./audio/score.js";
import { renderReport } from "./report-view.js";

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
const orb = createOrb($("orb"));
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
  if (s !== "idle") orb.set({ mode: s === "ringing" ? "ring" : s });
}

function meter() {
  setMeter($("strikes"), strikes, red);
  orb.set({ strikes, red });
}

function resetCall() {
  run++;
  queue = Promise.resolve();
  errorShown = false;
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
  $("liveBadge").hidden = true;
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
  orb.start();
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
  client = createVoiceClient({
    onStatus: (s) => my === run && onStatus(s),
    onTurn: (t) => my === run && feed.turn(t),
    onActions: (actions) => {
      if (my !== run) return;
      queue = queue.then(() => handleActions(actions, my)).catch(() => {});
    },
    onError: (err) => my === run && showError(err),
  });
  try {
    const r = await client.start(scen, { shareLive: $("share").checked && !useMock });
    if (r?.watchId && my === run) {
      $("liveBadge").href = `/live.html#${r.watchId}`;
      $("liveBadge").hidden = false;
    }
  } catch {
    /* onError already showed a friendly message */
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
  if ($("pill").dataset.s !== "unmasking" || s === "ended") setStatus(s);
}

async function handleActions(actions, my) {
  for (const a of actions) {
    if (my !== run) return;
    const e = a.event;
    // The ref stays quiet during the call so the conversation flows. Strikes, warnings and good moves are
    // recorded (Ref's view, and the reveal's events) and the report card shows them all at the end.
    if (a.type === "strike_called") {
      strikes = a.strikeNumber ?? strikes + 1;
      if (e) rv.add(e);
    } else if (a.type === "warning_shown" || a.type === "credit_shown") {
      if (e) rv.add(e);
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
  setStatus("unmasking");
  $("callerLbl").textContent = "The mask comes off";
  $("whoLbl").textContent = "This was a Scam Drill";
  $("stage").classList.add("unmasked");
  $("end").hidden = true;
  $("stopHint").hidden = true;
  if (a.ref?.say) {
    $("captionText").textContent = a.ref.say;
    $("caption").hidden = false;
    feed.unmask(a.ref.say);
  }
  await playRef(a, client);
  if (my !== run) return;
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
