// Owned by Agent F. The conversation feed, the Ref's view, and the strike meter, shared by the drill page,
// and the phone dashboard. All text goes in with textContent (never innerHTML).
import { TIER, DOWN, NUM, eventName, fmt } from "../content.js";

const el = (tag, cls, text) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
};

/**
 * @param log    the .chat element (role="log")
 * @param labels { them: "Unknown caller", me: "You" }
 */
export function createFeed(log, labels = { them: "Unknown caller", me: "You" }) {
  let lastSpeaker = null;
  const add = (node) => {
    log.querySelector(".empty")?.remove();
    log.append(node);
    log.scrollTop = log.scrollHeight;
  };
  return {
    clear(emptyText) {
      log.replaceChildren();
      lastSpeaker = null;
      if (emptyText) log.append(el("p", "empty", emptyText));
    },
    sys(text) {
      add(el("div", "sys", text));
      lastSpeaker = null;
    },
    turn(turn) {
      const kind = turn.speaker === "scammer" ? "them" : "me";
      if (lastSpeaker !== kind) add(el("div", `who-l${kind === "me" ? " r" : ""}`, labels[kind]));
      add(el("div", `msg ${kind}`, turn.text));
      lastSpeaker = kind;
    },
    unmask(text) {
      add(el("div", "who-l u", "Caller · dropping the act"));
      add(el("div", "msg unmask", text));
      lastSpeaker = null;
    },
    note(kind, head, text) {
      const d = el("div", `note ${kind}`);
      d.append(el("b", null, head), el("span", null, text));
      add(d);
      lastSpeaker = null;
    },
    /** A note for an action (strike / warning / credit / red card). */
    action(a) {
      const e = a.event;
      if (a.type === "strike_called" && e) {
        this.note("bad", `Strike ${NUM[a.strikeNumber] ?? ""}`.trim(), a.say ?? a.ref?.say ?? `${eventName(e)}.`);
      } else if (a.type === "warning_shown" && e) {
        this.note("warn", "Warning", `${eventName(e)}.`);
      } else if (a.type === "credit_shown" && e) {
        this.note("good", "Good move", `${eventName(e)}.`);
      } else if (a.type === "reveal" && a.outcome === "failed_autofail") {
        const red = e ?? a.events?.findLast?.((x) => x.tier === "autofail");
        this.note("bad", "Red card", red ? `${eventName(red)}.` : "That one ends the call.");
      }
    },
  };
}

/** The Ref's view: each call the ref makes, where it came from, and how sure it was. */
export function createRefsView(container) {
  return {
    clear(emptyText) {
      container.replaceChildren(el("p", "rv-empty", emptyText));
    },
    add(e) {
      if (!e) return;
      container.querySelector(".rv-empty")?.remove();
      const pct = Math.round((Number(e.confidence) || 0) * 100);
      const row = el("div", "rv-row");
      const main = el("div", "rv-main");
      const top = el("div", "rv-top");
      top.append(
        el("span", `tag t-${e.tier}`, TIER[e.tier] ?? e.tier),
        el("span", "rv-type", eventName(e)),
        el("span", `tag ${e.source}`, e.source === "ai" ? "AI judge" : "Rules")
      );
      const bar = el("div", "bar");
      bar.setAttribute("aria-hidden", "true");
      const fill = el("i");
      fill.style.width = `${pct}%`;
      bar.append(fill);
      main.append(top, bar);
      if (e.downgraded) main.append(el("div", "down", DOWN[e.downgraded] ?? "Downgraded"));
      const p = el("span", "pct", `${pct}%`);
      p.setAttribute("aria-label", `${pct} percent sure`);
      row.append(el("time", null, fmt(e.t)), main, p);
      container.append(row);
    },
  };
}

/** The bar-style strike meter (".strikes" with three <i> and a text span). */
export function setMeter(meterEl, strikes, red = false) {
  meterEl.querySelectorAll("i").forEach((i, n) => i.classList.toggle("on", n < strikes));
  const text = meterEl.querySelector("span");
  if (text) text.textContent = red ? "Red card" : `${strikes} of 3 strikes`;
}
