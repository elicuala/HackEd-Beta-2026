// Account routes. server.js loads this file automatically.
//   POST /api/auth/signup  { email, password, phone } -> { user: { phone: "•••• 1234" } } + session cookie
//   POST /api/auth/login   { email, password }        -> { user } + session cookie
//   POST /api/auth/logout                             -> { ok: true }
//   GET  /api/auth/me                                 -> { user } or { user: null }
import { openDatabase } from "./db.js";
import { createAuthService, AuthError, SESSION_DAYS } from "./service.js";

export const COOKIE = "sd_session";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

/** Reads one cookie without an extra package. */
export function readCookie(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function sessionCookie(req, value, maxAgeSeconds) {
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  return [
    `${COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

/** A small in-memory limiter for sign-up and log-in attempts, per IP. */
function createLimiter(now = () => Date.now()) {
  const hits = new Map();
  // Forget IPs with no recent attempts, so the map can't grow without bound.
  const sweep = setInterval(() => {
    const t = now();
    for (const [key, times] of hits) if (!times.some((at) => t - at < WINDOW_MS)) hits.delete(key);
  }, WINDOW_MS);
  sweep.unref?.();
  return (key) => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((at) => t - at < WINDOW_MS);
    recent.push(t);
    hits.set(key, recent);
    if (recent.length > MAX_ATTEMPTS)
      throw new AuthError("TOO_MANY_ATTEMPTS", 429, "Too many tries. Please wait a few minutes and try again.");
  };
}

/**
 * Account POSTs must be JSON. A plain HTML form can't send JSON, so another site can't submit a hidden form
 * that logs a visitor into an attacker's account (login CSRF) or logs them out.
 */
function requireJson(req) {
  if (!req.is("application/json")) throw new AuthError("BAD_REQUEST", 400, "Please send this as JSON.");
}

const unavailable = () =>
  new AuthError("AUTH_DISABLED", 503, "Accounts need Node 22.5 or newer on the server.");

/**
 * Registers the routes on `app`, synchronously: server.js doesn't await register(), and its /api 404
 * handler is added right after, so routes added later would never be reached.
 * `getService` returns (a promise of) the auth service, or null when accounts are unavailable.
 */
export function registerAuth(app, getService) {
  const limit = createLimiter();
  const need = async () => {
    const service = await getService();
    if (!service) throw unavailable();
    return service;
  };
  const begin = (req, res, { user, session }) => {
    res.set("Set-Cookie", sessionCookie(req, session.token, SESSION_DAYS * 24 * 60 * 60));
    res.set("Cache-Control", "no-store");
    res.json({ user: { phone: user.phone } });
  };

  app.post("/api/auth/signup", async (req, res) => {
    requireJson(req);
    limit(`signup:${req.ip}`);
    begin(req, res, await (await need()).signUp(req.body ?? {}));
  });

  app.post("/api/auth/login", async (req, res) => {
    requireJson(req);
    limit(`login:${req.ip}`);
    begin(req, res, await (await need()).logIn(req.body ?? {}));
  });

  app.post("/api/auth/logout", async (req, res) => {
    requireJson(req);
    (await getService())?.logOut(readCookie(req.headers.cookie, COOKIE));
    res.set("Set-Cookie", sessionCookie(req, "", 0));
    res.json({ ok: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    const user = (await getService())?.userForToken(readCookie(req.headers.cookie, COOKIE)) ?? null;
    res.set("Cache-Control", "no-store");
    res.json({ user: user && { phone: user.phone } });
  });

  // Malformed JSON fails in express.json() before the handlers: answer 400 BAD_REQUEST without the parser's text.
  app.use("/api/auth", (err, req, res, next) => {
    if (err?.type !== "entity.parse.failed" && err?.type !== "entity.too.large") return next(err);
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "Please send valid JSON." } });
  });
}

let servicePromise = null;
function defaultService() {
  servicePromise ??= openDatabase()
    .then((db) => (db ? createAuthService(db) : null))
    .catch(() => {
      console.error("[auth] could not open the accounts database");
      return null;
    });
  return servicePromise;
}

export default function register(app) {
  registerAuth(app, defaultService);
  defaultService(); // open the database at startup, not on the first request
}
