// The accounts database: SQLite through Node's built-in node:sqlite (Node 22.5 or newer, no extra package).
// The file lives at AUTH_DB_PATH, or data/scam-drill.db by default (git-ignored).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_DB_PATH = path.join(root, "data", "scam-drill.db");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email_hash    TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    phone         TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/** Opens (and creates) the database. Returns null if this Node version has no node:sqlite. */
export async function openDatabase(file = process.env.AUTH_DB_PATH || DEFAULT_DB_PATH) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return null;
  }
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

/**
 * The secret used to hash emails. AUTH_SECRET in .env is best (then the database alone is not enough
 * to test guessed emails). Without it, one is generated once and kept in the database, so logins
 * keep working across restarts.
 */
export function emailSecret(db, env = process.env) {
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'email_secret'").get();
  if (row) return row.value;
  const secret = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO meta (key, value) VALUES ('email_secret', ?)").run(secret);
  return secret;
}
