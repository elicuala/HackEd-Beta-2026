// Owned by Agent F. Short, polite toasts (announced to screen readers through a polite live region).
let host = null;

export function toast(text, kind = "", ms = 4200) {
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = text;
  host.append(t);
  setTimeout(() => t.remove(), ms);
}
