// Owned by Agent F. Theme (auto / light / dark) and text size (3 steps), remembered per browser.
// Adds two round buttons to the nav (.tools). The <head> snippet applies the saved choice before paint.
const THEMES = ["auto", "light", "dark"];
const SIZES = [1, 1.15, 1.3];
const SIZE_NAMES = { 1: "normal", 1.15: "large", 1.3: "extra large" };
const SIZE_GLYPH = { 1: "A", 1.15: "A+", 1.3: "A++" };
const root = document.documentElement;
const media = matchMedia("(prefers-color-scheme: light)");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const read = (k, d) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

let theme = THEMES.includes(read("scamDrill.theme", "auto")) ? read("scamDrill.theme", "auto") : "auto";
let size = SIZES.includes(Number(read("scamDrill.textSize", "1"))) ? Number(read("scamDrill.textSize", "1")) : 1;

const resolved = () => (theme === "auto" ? (media.matches ? "light" : "dark") : theme);
function applyTheme() {
  root.dataset.theme = resolved();
}
function applySize() {
  root.style.setProperty("--scale", String(size));
}

const ICONS = {
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>',
};

function themeButton(btn) {
  btn.innerHTML = ICONS[theme];
  const label = `Theme: ${theme === "auto" ? "match my device" : theme}. Click to change.`;
  btn.setAttribute("aria-label", label);
  btn.title = label;
}
function sizeButton(btn) {
  btn.textContent = SIZE_GLYPH[size];
  const label = `Text size: ${SIZE_NAMES[size]}. Click to change.`;
  btn.setAttribute("aria-label", label);
  btn.title = label;
}

/** Theme change with a circular reveal from the button (View Transitions), plain swap otherwise. */
function switchTheme(btn) {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  write("scamDrill.theme", theme);
  themeButton(btn);
  if (!document.startViewTransition || reduced) return applyTheme();
  const r = btn.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.classList.add("theme-switch");
  const vt = document.startViewTransition(applyTheme);
  vt.ready
    .then(() =>
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: "cubic-bezier(.22,.8,.2,1)", pseudoElement: "::view-transition-new(root)" }
      )
    )
    .catch(() => {});
  vt.updateCallbackDone.catch(() => {});
  vt.finished.catch(() => {}).finally(() => root.classList.remove("theme-switch"));
}

applyTheme();
applySize();
media.addEventListener?.("change", () => theme === "auto" && applyTheme());

const host = document.querySelector(".tools");
if (host) {
  const t = document.createElement("button");
  t.type = "button";
  t.className = "tool";
  themeButton(t);
  t.onclick = () => switchTheme(t);
  const s = document.createElement("button");
  s.type = "button";
  s.className = "tool";
  sizeButton(s);
  s.onclick = () => {
    size = SIZES[(SIZES.indexOf(size) + 1) % SIZES.length];
    write("scamDrill.textSize", String(size));
    applySize();
    sizeButton(s);
  };
  host.append(s, t);
}
