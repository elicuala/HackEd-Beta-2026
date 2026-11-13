// Owned by Agent F. report.html: the last drill (sessionStorage) or ?fixture=passed|failed-strikes|failed-autofail.
import { renderReport } from "./report-view.js";

const FIXTURES = new Set(["passed", "failed-strikes", "failed-autofail"]);

async function load() {
  const fixture = new URLSearchParams(location.search).get("fixture");
  if (FIXTURES.has(fixture)) {
    try {
      return await (await fetch(`/fixtures/reveal-${fixture}.json`)).json();
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(sessionStorage.getItem("scamDrill.result") ?? "null");
  } catch {
    return null;
  }
}

const result = await load();
if (result?.type === "reveal") {
  renderReport(document.getElementById("report"), result, { standalone: true });
} else {
  document.getElementById("report").hidden = true;
  document.getElementById("empty").hidden = false;
}
