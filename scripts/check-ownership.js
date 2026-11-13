// Usage: npm run check-ownership -- <frontend|backend|logic> [baseBranch=main]
// Fails if your branch changed any file you don't own (see ownership.json).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const map = JSON.parse(readFileSync(new URL("../ownership.json", import.meta.url), "utf8"));

/** Longest matching prefix wins. */
export function ownerOf(file) {
  let best = null;
  let bestLen = -1;
  for (const [role, paths] of Object.entries(map.owners)) {
    for (const p of paths) {
      const match = p.endsWith("/") ? file.startsWith(p) : file === p;
      if (match && p.length > bestLen) {
        best = role;
        bestLen = p.length;
      }
    }
  }
  return best;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const role = process.argv[2];
  const base = process.argv[3] || "main";
  if (!map.owners[role] || role === "foundation") {
    console.error("Usage: npm run check-ownership -- <frontend|backend|logic> [base]");
    process.exit(2);
  }
  const committed = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" });
  const uncommitted = execSync("git status --porcelain -uall", { encoding: "utf8" })
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
  const files = [...new Set([...committed.split("\n").filter(Boolean), ...uncommitted])];
  const bad = files.filter((f) => ownerOf(f) !== role);
  if (bad.length) {
    console.error(`Ownership violations for role "${role}":`);
    for (const f of bad) console.error(`  ${f}  (owned by ${ownerOf(f) ?? "nobody"})`);
    console.error("Revert these, or write a change request in your handoff file.");
    process.exit(1);
  }
  console.log(`OK: ${files.length} changed file(s), all owned by "${role}".`);
}
