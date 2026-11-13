// Owned by Agent F. phone.html: place a Twilio drill and watch it over GET /api/stream?callId= (SPEC §5.6).
import { api, friendly } from "./api.js";
import { STATUS, fmt } from "./content.js";
import { createFeed, createRefsView, setMeter } from "./ui/feed.js";

const $ = (id) => document.getElementById(id);
const feed = createFeed($("log"), { them: "Scam caller", me: "Person" });
const rv = createRefsView($("rv"));
let source = null;
let strikes = 0;
let red = false;
let t0 = 0;
let timer = null;

const setPill = (s) => {
  $("pill").dataset.s = s;
  $("pillText").textContent = s === "reveal" ? STATUS.ended : STATUS[s] ?? s;
};
const meter = () => setMeter($("strikes"), strikes, red);

function showError(err) {
  $("errorText").textContent = friendly(err);
  $("errorBox").hidden = false;
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
    started = await api.phoneStart($("number").value, $("scenario").value, $("share").checked);
  } catch (err) {
    $("call").disabled = !$("consent").checked;
    return showError(err);
  }
  watch(started.callId);
};

function watch(callId) {
  source?.close();
  strikes = 0;
  red = false;
  meter();
  feed.clear("Ringing… the words appear here once they answer.");
  rv.clear("Each call the ref makes appears here.");
  $("convMeta").textContent = $("scenario").selectedOptions[0]?.textContent ?? "";
  $("form").hidden = true;
  $("done").hidden = true;
  setPill("ringing");

  source = new EventSource(`/api/stream?callId=${encodeURIComponent(callId)}`);
  source.addEventListener("status", (m) => {
    const { status } = JSON.parse(m.data);
    setPill(status === "live" ? "live" : "reveal");
  });
  source.addEventListener("turn", (m) => {
    if (!t0) {
      t0 = performance.now();
      timer = setInterval(() => ($("clock").textContent = fmt((performance.now() - t0) / 1000)), 500);
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
      if (a.outcome === "failed_autofail") {
        red = true;
        strikes = 3;
        meter();
        rv.add(a.events?.findLast?.((e) => e.tier === "autofail"));
        feed.action(a);
      }
      if (a.ref?.say) feed.unmask(a.ref.say);
      feed.sys("CALL ENDED");
      try {
        sessionStorage.setItem("scamDrill.result", JSON.stringify(a));
      } catch {
        /* private mode */
      }
      clearInterval(timer);
      source.close();
      $("done").hidden = false;
    }
  });
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED && $("done").hidden) showError({ code: "CONNECTION_LOST" });
  };
}

$("again").onclick = () => {
  $("done").hidden = true;
  $("form").hidden = false;
  $("call").disabled = !$("consent").checked;
  t0 = 0;
  $("clock").textContent = "0:00";
  setPill("idle");
};

init();
