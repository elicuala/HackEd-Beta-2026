// Owned by Agent B. The live board: drills people chose to share, streamed to anyone watching the site.
//
// Privacy:
// - Only calls whose caller opted in (shareLive) are on the board.
// - Watchers get a separate random watchId, NEVER the callId (the callId can drive or end a call).
// - Everything shown is already redacted by the core (digits and spoken numbers), plus ref lines (no digits).
import { randomUUID } from "node:crypto";
import { subscribe } from "../core/bus.js";
import { getCall } from "../core/calls.js";
import { getScenario } from "../scenarios/index.js";
import { redactSpeech } from "../shared/contract.js";

const KEEP_ENDED_MS = 15 * 60 * 1000; // ended drills stay on the board for 15 minutes
const MAX_AGE_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 50;
const MAX_ITEMS = 400;

const byCall = new Map(); // callId → entry
const byWatch = new Map(); // watchId → entry

/** What spectators see for one action. No callId, no full events list. */
function actionItem(a) {
  // For a red-card reveal, show which autofail ended it.
  const e = a.event ?? (a.type === "reveal" ? a.events?.findLast?.((x) => x.tier === "autofail") : null);
  return {
    kind: "action",
    type: a.type,
    strikeNumber: a.strikeNumber ?? null,
    outcome: a.outcome ?? null,
    say: a.ref?.say ? redactSpeech(a.ref.say) : null,
    sound: a.ref?.sound ?? null,
    event: e
      ? {
          tier: e.tier,
          type: e.type,
          quote: redactSpeech(e.quote),
          source: e.source,
          confidence: e.confidence,
          downgraded: e.downgraded ?? null,
          t: e.t,
        }
      : null,
  };
}

function summary(entry) {
  const lastTurn = [...entry.items].reverse().find((i) => i.kind === "turn");
  return {
    watchId: entry.watchId,
    scenarioId: entry.scenarioId,
    title: entry.title,
    channel: entry.channel,
    status: entry.status,
    outcome: entry.outcome,
    strikes: entry.strikes,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    lines: entry.items.filter((i) => i.kind === "turn").length,
    lastLine: lastTurn ? { speaker: lastTurn.speaker, text: lastTurn.text.slice(0, 140) } : null,
  };
}

function push(entry, item) {
  entry.items.push(item);
  if (entry.items.length > MAX_ITEMS) entry.items.splice(0, entry.items.length - MAX_ITEMS);
  for (const fn of entry.watchers) fn("item", item);
}

function setStatus(entry, status) {
  if (entry.status === status) return;
  entry.status = status;
  if (status !== "live") entry.endedAt = entry.endedAt ?? Date.now();
  for (const fn of entry.watchers) fn("status", { status, outcome: entry.outcome });
}

function onBus({ callId, kind, data }) {
  const entry = byCall.get(callId);
  if (!entry) return;
  if (kind === "turn") {
    push(entry, { kind: "turn", speaker: data.speaker, text: redactSpeech(data.text), t: data.t });
  } else if (kind === "action") {
    if (data.type === "strike_called") entry.strikes = data.strikeNumber ?? entry.strikes + 1;
    if (data.type === "reveal") entry.outcome = data.outcome ?? null;
    push(entry, actionItem(data));
  } else if (kind === "status") {
    setStatus(entry, data.status);
  }
}

let unsubscribe = null;
function ensureSubscribed() {
  if (!unsubscribe) unsubscribe = subscribe(null, onBus);
}

function prune(now = Date.now()) {
  for (const entry of byCall.values()) {
    const old = now - entry.startedAt > MAX_AGE_MS;
    const endedLongAgo = entry.endedAt && now - entry.endedAt > KEEP_ENDED_MS;
    if (old || endedLongAgo) remove(entry);
  }
  // Oldest first if there are too many.
  const all = [...byCall.values()].sort((a, b) => a.startedAt - b.startedAt);
  while (all.length > MAX_ENTRIES) remove(all.shift());
}

function remove(entry) {
  byCall.delete(entry.callId);
  byWatch.delete(entry.watchId);
  for (const fn of entry.watchers) fn("gone", {});
  entry.watchers.clear();
}

const pruneTimer = setInterval(() => prune(), 60 * 1000);
pruneTimer.unref?.();

/**
 * Put a call on the live board (the caller opted in). Safe to call right after createCall.
 * @returns {string|null} watchId, or null if the call doesn't exist
 */
export function shareCall(callId) {
  ensureSubscribed();
  const existing = byCall.get(callId);
  if (existing) return existing.watchId;
  const call = getCall(callId);
  if (!call) return null;
  let title = call.scenarioId;
  try {
    title = getScenario(call.scenarioId).title;
  } catch {
    /* keep the id */
  }
  const entry = {
    watchId: randomUUID(),
    callId,
    scenarioId: call.scenarioId,
    title,
    channel: call.channel,
    status: call.status,
    outcome: call.outcome,
    strikes: call.strikes,
    startedAt: Date.now(),
    endedAt: null,
    items: call.history.map((h) => ({ kind: "turn", speaker: h.speaker, text: redactSpeech(h.text), t: h.t })),
    watchers: new Set(),
  };
  byCall.set(callId, entry);
  byWatch.set(entry.watchId, entry);
  prune();
  return entry.watchId;
}

/** Take a call off the board (e.g. the phone call could not be placed). */
export function unshareCall(callId) {
  const entry = byCall.get(callId);
  if (entry) remove(entry);
}

const NEVER_STARTED_MS = 2 * 60 * 1000;

/**
 * Newest first. A drill is listed once its call has really started (the first line was spoken), so a
 * connection that failed never shows up as a ghost "live" drill. Its watch link still works meanwhile.
 */
export function listBoard() {
  prune();
  const now = Date.now();
  for (const e of [...byCall.values()]) {
    if (!e.items.length && e.status === "live" && now - e.startedAt > NEVER_STARTED_MS) remove(e);
  }
  return [...byCall.values()]
    .filter((e) => e.items.length > 0 || e.status !== "live")
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(summary);
}

/**
 * Watch one drill. fn(kind, data) gets "item", "status", and "gone".
 * @returns {{ snapshot: object, unwatch: () => void } | null}
 */
export function watch(watchId, fn) {
  const entry = byWatch.get(watchId);
  if (!entry) return null;
  entry.watchers.add(fn);
  return {
    snapshot: { ...summary(entry), items: entry.items.slice() },
    unwatch: () => entry.watchers.delete(fn),
  };
}

export function _resetBoardForTests() {
  for (const entry of [...byCall.values()]) remove(entry);
}
