// Owned by Agent F. phone.html: place a Twilio drill and watch it over GET /api/stream?callId= (SPEC §5.6).
// "Take over call": the person at this page replaces the AI caller. Their mic goes to the phone and the phone's
// voice plays here, over the /phone/takeover WebSocket (base64 μ-law frames both ways). The ref stops scoring.
import { api, friendly } from "./api.js";
import { STATUS, fmt } from "./content.js";
import { createFeed, createRefsView, setMeter } from "./ui/feed.js";
import { openLine } from "./phone-audio.js";

const $ = (id) => document.getElementById(id);
const feed = createFeed($("log"), { them: "Scam caller", me: "Person" });
const rv = createRefsView($("rv"));
let source = null;
let callId = null;
let strikes = 0;
let red = false;
let t0 = 0;
let timer = null;
let line = null; // { ws, audio } while this page has the phone line
let tookOver = false;
let over = false; // the reveal has arrived

const setPill = (s) => {
  $("pill").dataset.s = s;
  $("pillText").textContent = s === "reveal" ? STATUS.ended : STATUS[s] ?? s;
};
const meter = () => setMeter($("strikes"), strikes, red);

function showError(err) {
  $("errorText").textContent = friendly(err);
  $("errorBox").hidden = false;
}

/** "hidden" (no call yet, or it's over), "offer" (the button), "on" (you have the line). */
function setTakeover(state) {
  const box = $("takeoverBox");
  box.hidden = state === "hidden";
  box.dataset.state = state;
  $("takeoverOffer").hidden = state !== "offer";
  $("takeoverOn").hidden = state !== "on";
  $("takeover").disabled = state !== "offer";
}

async function init() {
  let numbers;
  try {
    numbers = await api.phoneNumbers();
  } catch (err) {
    if (err.code === "PHONE_DISABLED" || err.code === "HTTP_404") {
      $("disabled").hidden = false;
      return;
    }
    return showError(err);
  }
  let scenarios = [];
  try {
    scenarios = await api.scenarios();
  } catch (err) {
    return showError(err);
  }
  for (const n of numbers) $("number").append(new Option(n.label, n.id));
  for (const s of scenarios) $("scenario").append(new Option(s.title, s.id));
  $("form").hidden = false;
  $("consent").onchange = (e) => ($("call").disabled = !e.target.checked);
}

$("form").onsubmit = async (ev) => {
  ev.preventDefault();
  $("errorBox").hidden = true;
  $("call").disabled = true;
  let started;
  try {
    started = await api.phoneStart($("number").value, $("scenario").value);
  } catch (err) {
    $("call").disabled = !$("consent").checked;
    return showError(err);
  }
  watch(started.callId);
};

function watch(id) {
  source?.close();
  dropLine();
  callId = id;
  tookOver = false;
  over = false;
  strikes = 0;
  red = false;
  meter();
  feed.clear("Ringing… the words appear here once they answer.");
  rv.clear("Each call the ref makes appears here.");
  $("convMeta").textContent = $("scenario").selectedOptions[0]?.textContent ?? "";
  $("form").hidden = true;
  $("done").hidden = true;
  $("stageHint").textContent = "The ref scores the call here without interrupting it. The unmask plays on the phone at the end.";
  setTakeover("hidden");
  setPill("ringing");

  source = new EventSource(`/api/stream?callId=${encodeURIComponent(callId)}`);
  source.addEventListener("status", (m) => {
    const { status } = JSON.parse(m.data);
    if (line || tookOver) return; // the pill says "you're on the call" until the reveal
    setPill(status === "live" ? "live" : "reveal");
  });
  source.addEventListener("turn", (m) => {
    if (!t0) {
      // The first line means the phone was answered and the AI is on: from here you can take over.
      t0 = performance.now();
      timer = setInterval(() => ($("clock").textContent = fmt((performance.now() - t0) / 1000)), 500);
      setPill("live");
      setTakeover("offer");
    }
    feed.turn(JSON.parse(m.data));
  });
  source.addEventListener("action", (m) => {
    const a = JSON.parse(m.data);
    if (a.type === "strike_called") {
      strikes = a.strikeNumber;
      meter();
      rv.add(a.event);
      feed.action({ ...a, say: a.ref?.say });
    } else if (a.type === "warning_shown" || a.type === "credit_shown") {
      rv.add(a.event);
      feed.action(a);
    } else if (a.type === "reveal") {
      finish(a);
    }
  });
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED && $("done").hidden) showError({ code: "CONNECTION_LOST" });
  };
}

function finish(a) {
  over = true;
  if (a.outcome === "failed_autofail") {
    red = true;
    strikes = 3;
    meter();
    rv.add(a.events?.findLast?.((e) => e.tier === "autofail"));
    feed.action(a);
  }
  // After a take-over nobody spoke the unmask line, so don't show it as if they had.
  if (a.ref?.say && !tookOver) feed.unmask(a.ref.say);
  feed.sys("CALL ENDED");
  try {
    sessionStorage.setItem("scamDrill.result", JSON.stringify(a));
  } catch {
    /* private mode */
  }
  clearInterval(timer);
  source.close();
  dropLine();
  setTakeover("hidden");
  setPill("reveal");
  $("done").hidden = false;
}

// ---------- take over the call ----------

$("takeover").onclick = async () => {
  if (!callId || line || over) return;
  $("takeover").disabled = true;
  $("errorBox").hidden = true;
  if (!("AudioWorklet" in window) || !("WebSocket" in window) || !navigator.mediaDevices?.getUserMedia) {
    $("takeover").disabled = false;
    return showError({ code: "TAKEOVER_UNSUPPORTED" });
  }
  let audio;
  try {
    audio = await openLine({
      onFrame: (payload) => {
        if (line?.ws.readyState === 1) line.ws.send(JSON.stringify({ event: "media", payload }));
      },
    });
  } catch (err) {
    $("takeover").disabled = false;
    return showError(err);
  }
  if (over) return audio.close(); // the call ended while the mic prompt was up
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/phone/takeover?callId=${encodeURIComponent(callId)}`);
  line = { ws, audio };
  ws.onmessage = (m) => {
    let msg;
    try {
      msg = JSON.parse(m.data);
    } catch {
      return;
    }
    if (line?.ws !== ws) return;
    if (msg.event === "ready") onLine();
    else if (msg.event === "media" && typeof msg.payload === "string") audio.play(msg.payload);
  };
  ws.onclose = (e) => {
    if (line?.ws !== ws) return;
    dropLine();
    if (e.code === 4404) {
      setTakeover(over ? "hidden" : "offer");
      showError({ code: "NO_LIVE_CALL" });
    }
    // Any other close means the server ended the drill; the reveal arrives over the stream.
  };
};

function onLine() {
  tookOver = true;
  setTakeover("on");
  setPill("human");
  $("stageHint").textContent = "You're talking to them now. The ref has stepped back.";
  $("convMeta").textContent = "Transcript stopped";
  feed.sys("YOU TOOK OVER THE CALL");
  $("hangup").focus();
}

$("hangup").onclick = () => {
  if (!line) return;
  $("hangup").disabled = true;
  try {
    line.ws.send(JSON.stringify({ event: "end" }));
  } catch {
    dropLine();
  }
  // The server hangs up the phone and ends the drill; the reveal arrives over the stream.
};

function dropLine() {
  if (!line) return;
  const { ws, audio } = line;
  line = null;
  ws.onclose = null;
  ws.onmessage = null;
  try {
    ws.close();
  } catch {
    /* ignore */
  }
  audio.close();
  $("hangup").disabled = false;
}

addEventListener("pagehide", () => {
  // Leaving the page while on the line: the server sees the socket close and hangs up the phone.
  dropLine();
});

$("again").onclick = () => {
  $("done").hidden = true;
  $("form").hidden = false;
  $("call").disabled = !$("consent").checked;
  t0 = 0;
  tookOver = false;
  $("clock").textContent = "0:00";
  $("stageHint").textContent = "The ref scores the call here without interrupting it. The unmask plays on the phone at the end.";
  setTakeover("hidden");
  setPill("idle");
};

init();
