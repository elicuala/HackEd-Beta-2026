// Owned by Agent F. The live board: list of shared drills (polled) + one drill streamed over SSE.
//   GET /api/live                 every 3 s
//   GET /api/live/stream?watchId= snapshot, item, status, gone
import { api } from "./api.js";
import { createFeed, createRefsView, setMeter } from "./ui/feed.js";

const $ = (id) => document.getElementById(id);
const feed = createFeed($("log"), { them: "Scam caller", me: "Person" });
const rv = createRefsView($("rv"));

let watching = null; // watchId
let source = null;
let board = [];
let strikes = 0;
let red = false;

const STATUS_TEXT = { live: "Live", reveal: "Ended" };
const OUTCOME_TEXT = { passed: "Passed", failed_strikes: "3 strikes", failed_autofail: "Red card" };

function conn(state, text) {
  $("conn").dataset.s = state;
  $("connText").textContent = text;
}

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

// ---------- the list ----------

function renderList() {
  const box = $("drills");
  const live = board.filter((d) => d.status === "live").length;
  $("listMeta").textContent = board.length ? `${live} live · ${board.length - live} ended` : "None yet";
  box.replaceChildren();
  if (!board.length) {
    const p = document.createElement("li");
    p.className = "empty";
    p.style.padding = "18px 6px";
    p.textContent = "No drills right now. Start one on the Drill page with \"Show on the live board\" ticked, and it appears here.";
    box.append(p);
    return;
  }
  for (const d of board) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "drill-card";
    card.setAttribute("aria-pressed", String(d.watchId === watching));
    const row = document.createElement("div");
    row.className = "row";
    const title = document.createElement("b");
    title.textContent = d.title;
    const badge = document.createElement("span");
    badge.className = `badge ${d.status === "live" ? "onair" : "ended"}`;
    badge.textContent = d.status === "live" ? "● Live" : OUTCOME_TEXT[d.outcome] ?? "Ended";
    row.append(title, badge);
    const meta = document.createElement("small");
    meta.textContent = `${d.channel === "phone" ? "Phone · " : ""}${d.strikes} of 3 strikes · started ${ago(d.startedAt)}`;
    const last = document.createElement("small");
    last.textContent = d.lastLine ? `${d.lastLine.speaker === "scammer" ? "Caller" : "Person"}: "${d.lastLine.text}"` : "Ringing…";
    card.append(row, meta, last);
    card.onclick = () => {
      $("follow").checked = false;
      open(d.watchId);
    };
    const li = document.createElement("li");
    li.append(card);
    box.append(li);
  }
}

async function poll() {
  try {
    board = await api.liveBoard();
    conn("live", "Connected");
  } catch {
    conn("ended", "Reconnecting…");
    return;
  }
  // Follow mode: jump to the newest live drill.
  const newestLive = board.find((d) => d.status === "live");
  const hashId = location.hash.slice(1);
  if (!watching && hashId && board.some((d) => d.watchId === hashId)) open(hashId);
  else if ($("follow").checked && newestLive && newestLive.watchId !== watching) open(newestLive.watchId);
  else if (!watching && board[0]) open(board[0].watchId);
  renderList();
}

// ---------- one drill ----------

function meter() {
  setMeter($("strikes"), strikes, red);
}

function setWatchStatus(status, outcome) {
  const b = $("watchStatus");
  b.hidden = false;
  b.className = `badge ${status === "live" ? "onair" : "ended"}`;
  b.textContent = status === "live" ? "● Live" : OUTCOME_TEXT[outcome] ?? STATUS_TEXT[status] ?? "Ended";
}

function applyItem(item) {
  if (item.kind === "turn") return feed.turn(item);
  const e = item.event;
  if (item.type === "strike_called") {
    strikes = item.strikeNumber ?? strikes + 1;
    meter();
    rv.add(e);
    feed.action(item);
  } else if (item.type === "warning_shown" || item.type === "credit_shown") {
    rv.add(e);
    feed.action(item);
  } else if (item.type === "reveal") {
    if (item.outcome === "failed_autofail") {
      red = true;
      strikes = 3;
      meter();
      rv.add(e);
      feed.action({ ...item, event: e });
    }
    if (item.say) feed.unmask(item.say);
    feed.sys(`DRILL OVER · ${OUTCOME_TEXT[item.outcome] ?? "ENDED"}`.toUpperCase());
  }
}

function open(watchId) {
  if (watchId === watching) return;
  source?.close();
  watching = watchId;
  history.replaceState(null, "", `#${watchId}`);
  strikes = 0;
  red = false;
  meter();
  feed.clear("Connecting to the drill…");
  rv.clear("Each call the ref makes appears here, with where it came from and how sure it was.");
  renderList();

  source = new EventSource(`/api/live/stream?watchId=${encodeURIComponent(watchId)}`);
  source.addEventListener("snapshot", (m) => {
    const snap = JSON.parse(m.data);
    $("watchH").textContent = `${snap.title}${snap.channel === "phone" ? " · phone" : ""}`;
    feed.clear(snap.items.length ? null : "Waiting for the first words…");
    for (const item of snap.items) applyItem(item);
    setWatchStatus(snap.status, snap.outcome);
  });
  source.addEventListener("item", (m) => {
    $("log").querySelector(".empty")?.remove();
    const item = JSON.parse(m.data);
    applyItem(item);
    if (item.type === "strike_called" || item.type === "reveal") poll(); // keep the list's counts fresh
  });
  source.addEventListener("status", (m) => {
    const { status, outcome } = JSON.parse(m.data);
    setWatchStatus(status, outcome);
    poll();
  });
  source.addEventListener("gone", () => {
    source.close();
    feed.sys("THIS DRILL LEFT THE BOARD");
  });
  source.onerror = () => {
    // 404 (drill gone) closes for good; network blips reconnect automatically.
    if (source.readyState === EventSource.CLOSED && watching === watchId) {
      watching = null;
      $("watchH").textContent = "That drill isn't on the board anymore";
    }
  };
}

poll();
setInterval(poll, 3000);
// Keep "started … ago" fresh.
setInterval(() => board.length && renderList(), 15000);
window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (id && id !== watching) {
    $("follow").checked = false;
    open(id);
  }
});
