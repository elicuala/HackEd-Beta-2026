// Owned by Agent F. Renders a RevealResult as the report card (inline on the drill page and on report.html).
import { SCENARIO_UI, DEFAULT_HABIT, TIER, TIER_COLOR, GOOD_LINES, eventName, fmt } from "./content.js";
import { replay } from "./audio/replay.js";
import { unlock } from "./audio/engine.js";

const el = (tag, cls, text) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
};

// The most common tactic decides the takeaway habit when the scenario has none.
const TACTIC_HABITS = {
  secrecy: "Real officials and real family never ask you to keep a call secret. Tell someone you trust.",
  stayed_on_line: "You can always hang up. A real caller will still be there when you call back on an official number.",
  urgency: "Slow down. Real problems can wait the five minutes it takes to check.",
  gift_card: "No real agency or bank ever takes payment in gift cards.",
  card_number: "Never read a card number to someone who called you.",
  password_or_code: "Never share a code that was texted to you. It's the key to your account.",
};

function takeaway(result) {
  const counts = {};
  for (const e of result.events ?? []) if (e.tier !== "good_defense") counts[e.type] = (counts[e.type] ?? 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return SCENARIO_UI[result.scenarioId]?.habit ?? TACTIC_HABITS[top] ?? DEFAULT_HABIT;
}

/**
 * @param host    element to render into (its children are replaced)
 * @param result  RevealResult (the reveal WireAction)
 * @param opts    { onAgain?: () => void, standalone?: boolean }
 */
export function renderReport(host, result, opts = {}) {
  const events = Array.isArray(result?.events) ? result.events : [];
  const outcome = result?.outcome;
  const passed = outcome === "passed";
  const title = result?.scenarioTitle ?? "practice";
  const strikes = events.filter((e) => e.tier === "strike").length;
  const ringTxt = passed
    ? ["Passed", "WELL DONE"]
    : outcome === "failed_autofail"
      ? ["Red card", "PRACTICE"]
      : [`${strikes} of 3`, "STRIKES"];
  const colors = passed ? ["var(--green)", "var(--teal)"] : ["var(--red)", "var(--orange)"];

  host.replaceChildren();

  // Header: outcome ring + headline.
  const head = el("div", "glass rhead");
  const ring = el("div", "ring");
  ring.style.setProperty("--c1", colors[0]);
  ring.style.setProperty("--c2", colors[1]);
  const ringIn = el("div");
  ringIn.append(el("b", null, ringTxt[0]), el("small", null, ringTxt[1]));
  ring.append(ringIn);
  const words = el("div");
  const kicker = el("div", "kicker", `Report card · ${title}`);
  const h = el(opts.standalone ? "h1" : "h2", null, passed
    ? `You passed the ${title} drill.`
    : "Not this time, and that's exactly what practice is for.");
  h.id = "repH";
  words.append(kicker, h, el("p", null, `${strikes} of 3 strikes${outcome === "failed_autofail" ? " · red card" : ""}. Nothing from this call was saved.`));
  head.append(ring, words);
  host.append(head);

  // Timeline + replay.
  let items = [];
  if (events.length) {
    const box = el("div", "glass");
    const label = el("div", "label");
    label.append(el("span", null, "What happened"), el("b", null, `${events.length} ${events.length === 1 ? "call" : "calls"}`));
    const ol = el("ol", "tl");
    items = events.map((e) => {
      const li = el("li");
      const node = el("span", "node");
      node.style.setProperty("--nc", TIER_COLOR[e.tier] ?? "var(--text-3)");
      node.setAttribute("aria-hidden", "true");
      const body = el("div");
      const name = el("b", null, eventName(e));
      name.style.display = "inline";
      body.append(el("span", `tag t-${e.tier}`, TIER[e.tier] ?? e.tier), document.createTextNode(" "), name, el("br"), el("q", null, e.quote));
      li.append(el("time", null, fmt(e.t)), node, body);
      ol.append(li);
      return li;
    });
    const rp = el("div", "replay");
    const btn = el("button", "go ghost", "▶ Replay your drill");
    btn.type = "button";
    const hint = el("span", "hint", "Hear the call as music: good moves rise, strikes fall.");
    let player = null;
    btn.onclick = () => {
      if (player) return player.stop();
      unlock();
      btn.textContent = "■ Stop";
      player = replay(events, {
        onNote: (i) => {
          items.forEach((li, n) => {
            li.classList.toggle("playing", n === i);
            if (n === i) li.setAttribute("aria-current", "step");
            else li.removeAttribute("aria-current");
          });
        },
        onDone: () => {
          items.forEach((li) => {
            li.classList.remove("playing");
            li.removeAttribute("aria-current");
          });
          btn.textContent = "▶ Replay your drill";
          player = null;
        },
      });
    };
    rp.append(btn, hint);
    box.append(label, ol, rp);
    host.append(box);
  }

  // What you did well + one habit.
  const two = el("div", "two");
  const good = events.filter((e) => e.tier === "good_defense");
  const wellText = good.length
    ? [...new Set(good.map((g) => GOOD_LINES[g.type] ?? `${eventName(g)}.`))].join(" ")
    : "You stayed on the line long enough to learn something. That counts.";
  for (const [title2, text, cls] of [["What you did well", wellText, "big"], ["One habit to keep", takeaway(result ?? {}), "big habit"]]) {
    const g = el("div", "glass");
    const label = el("div", "label");
    label.append(el("span", null, title2));
    g.append(label, el("div", cls, text));
    two.append(g);
  }
  host.append(two);

  // Buttons.
  const row = el("div", "btnrow");
  const again = el("a", "go ghost", "Try another drill");
  again.href = "/";
  if (opts.onAgain) {
    again.addEventListener("click", (ev) => {
      ev.preventDefault();
      opts.onAgain();
    });
  }
  const print = el("button", "go ghost", "Print report card");
  print.type = "button";
  print.onclick = () => window.print();
  row.append(again, print);
  host.append(row);
}
