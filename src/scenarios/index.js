// STUB (owned by Agent L). Keep these exact signatures. Add grandkid.json and bank_fraud.json.
import { readFileSync, readdirSync } from "node:fs";
import { SCENARIO_FIELDS } from "../shared/contract.js";

const dir = new URL("./", import.meta.url);
const scenarios = new Map();

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const s = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
  const missing = SCENARIO_FIELDS.filter((k) => !(k in s));
  if (missing.length) throw new Error(`Scenario ${file} missing: ${missing.join(", ")}`);
  scenarios.set(s.id, s);
}

export function getScenario(id) {
  const s = scenarios.get(id);
  if (!s) {
    const err = new Error(`Unknown scenario: ${id}`);
    err.code = "SCENARIO_NOT_FOUND";
    err.status = 404;
    err.expose = true;
    throw err;
  }
  return s;
}

export function listScenarios() {
  return [...scenarios.values()].map(({ id, title, blurb }) => ({ id, title, blurb }));
}
