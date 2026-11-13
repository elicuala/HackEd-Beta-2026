// FOUNDATION: locked. Do not edit. Add routes in your own folder's routes.js instead.
//
// Auto-loads every src/<folder>/routes.js:
//   export default function register(app) { ... }   // Express routes (optional)
//   export function attach(server) { ... }           // raw http server, e.g. WebSocket upgrades (optional)
import "dotenv/config";
import express from "express";
import http from "node:http";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false })); // Twilio webhooks post form data
app.use(express.static(path.join(root, "public")));

const server = http.createServer(app);

const srcDir = path.join(root, "src");
for (const dir of readdirSync(srcDir).sort()) {
  const file = path.join(srcDir, dir, "routes.js");
  if (!existsSync(file)) continue;
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.default === "function") mod.default(app);
  if (typeof mod.attach === "function") mod.attach(server);
  console.log(`[routes] loaded src/${dir}/routes.js`);
}

app.use("/api", (req, res) =>
  res.status(404).json({ error: { code: "NOT_FOUND", message: "No such endpoint" } })
);

// Express 5 forwards rejected promises from async handlers here.
app.use((err, req, res, _next) => {
  console.error("[error]", err.code || err.name);
  res.status(err.status || 500).json({
    error: { code: err.code || "INTERNAL", message: err.expose ? err.message : "Internal error" },
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`Scam Drill running on http://localhost:${port}`));
