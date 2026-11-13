// Owned by Agent F. Runs in <head> before paint (a plain script, like WayKin's theme.js), so the page never
// flashes the wrong theme. ui/prefs.js adds the buttons that change these settings.
(function () {
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem("scamDrill.theme") || "auto";
    var light = window.matchMedia("(prefers-color-scheme: light)").matches;
    root.setAttribute("data-theme", saved === "light" || saved === "dark" ? saved : light ? "light" : "dark");
    var size = Number(localStorage.getItem("scamDrill.textSize")) || 1;
    root.style.setProperty("--scale", String(size));
  } catch (err) {
    root.setAttribute("data-theme", "light");
  }
})();
