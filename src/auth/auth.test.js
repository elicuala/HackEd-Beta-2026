import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { openDatabase } from "./db.js";
import { createAuthService, normalizePhone, maskPhone } from "./service.js";
import { hashEmail, hashPassword, verifyPassword } from "./hashing.js";
import { registerAuth, readCookie, COOKIE } from "./routes.js";

const env = { AUTH_SECRET: "test-secret" };
async function fresh(now) {
  const db = await openDatabase(":memory:");
  return { db, auth: createAuthService(db, { env, ...(now && { now }) }) };
}
const good = { email: "Grandma@Example.com", password: "correct horse", phone: "(780) 555-1234" };

test("hashing: emails hash the same after trimming and lowercasing, and need the secret", () => {
  assert.equal(hashEmail(" Grandma@Example.COM ", "s"), hashEmail("grandma@example.com", "s"));
  assert.notEqual(hashEmail("grandma@example.com", "s"), hashEmail("grandma@example.com", "other"));
  assert.match(hashEmail("a@b.co", "s"), /^[0-9a-f]{64}$/);
});

test("hashing: passwords are salted scrypt hashes", async () => {
  const a = await hashPassword("pw123456");
  const b = await hashPassword("pw123456");
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword("pw123456", a), true);
  assert.equal(await verifyPassword("pw1234567", a), false);
  assert.equal(await verifyPassword("x", "garbage"), false);
});

test("db: nothing readable is stored for email or password", async () => {
  const { db, auth } = await fresh();
  await auth.signUp(good);
  const row = db.prepare("SELECT * FROM users").get();
  const dump = JSON.stringify(db.prepare("SELECT * FROM users").all());
  assert.ok(!dump.toLowerCase().includes("grandma"));
  assert.ok(!dump.includes("correct horse"));
  assert.equal(row.email_hash, hashEmail(good.email, env.AUTH_SECRET));
  assert.equal(row.phone, "+17805551234");
  const sessions = JSON.stringify(db.prepare("SELECT * FROM sessions").all());
  assert.match(sessions, /"token_hash":"[0-9a-f]{64}"/);
});

test("signup: returns a masked phone and a session; duplicate emails are refused", async () => {
  const { auth } = await fresh();
  const { user, session } = await auth.signUp(good);
  assert.equal(user.phone, "•••• 1234");
  assert.ok(session.token.length >= 40);
  await assert.rejects(auth.signUp({ ...good, email: "grandma@example.com" }), { code: "EMAIL_TAKEN", status: 409 });
});

test("signup: validates email, password, and phone", async () => {
  const { auth } = await fresh();
  await assert.rejects(auth.signUp({ ...good, email: "nope" }), { code: "BAD_REQUEST" });
  await assert.rejects(auth.signUp({ ...good, password: "short" }), { code: "BAD_REQUEST" });
  await assert.rejects(auth.signUp({ ...good, password: 12345678 }), { code: "BAD_REQUEST" });
  await assert.rejects(auth.signUp({ ...good, phone: "12" }), { code: "BAD_REQUEST" });
  await assert.rejects(auth.signUp(), { code: "BAD_REQUEST" });
});

test("login: right password works, wrong password and unknown email give the same error", async () => {
  const { auth } = await fresh();
  await auth.signUp(good);
  const { user } = await auth.logIn({ email: " GRANDMA@example.com", password: good.password });
  assert.equal(user.phone, "•••• 1234");
  await assert.rejects(auth.logIn({ email: good.email, password: "wrong password" }), { code: "INVALID_LOGIN", status: 401 });
  await assert.rejects(auth.logIn({ email: "nobody@example.com", password: good.password }), { code: "INVALID_LOGIN" });
  await assert.rejects(auth.logIn({}), { code: "BAD_REQUEST" });
});

test("sessions: log out ends the session, and sessions expire", async () => {
  let t = 1_000_000;
  const { auth } = await fresh(() => t);
  const { session } = await auth.signUp(good);
  assert.equal(auth.userForToken(session.token).phone, "•••• 1234");
  auth.logOut(session.token);
  assert.equal(auth.userForToken(session.token), null);
  const second = await auth.logIn(good);
  t += 8 * 24 * 60 * 60 * 1000;
  assert.equal(auth.userForToken(second.session.token), null);
  assert.equal(auth.userForToken(""), null);
  assert.equal(auth.userForToken(undefined), null);
});

test("phone: normalized to E.164 and masked to the last four digits", () => {
  assert.equal(normalizePhone("780 555 1234"), "+17805551234");
  assert.equal(normalizePhone("1-780-555-1234"), "+17805551234");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("555 1234"), null);
  assert.equal(normalizePhone(""), null);
  assert.equal(maskPhone("+17805551234"), "•••• 1234");
});

test("cookies: reads one cookie by name", () => {
  assert.equal(readCookie("a=1; sd_session=abc%2Fd; b=2", COOKIE), "abc/d");
  assert.equal(readCookie("a=1", COOKIE), null);
  assert.equal(readCookie(undefined, COOKIE), null);
});

// ---------- HTTP (local server on 127.0.0.1, no outside network) ----------

async function serve(service) {
  const app = express();
  app.use(express.json());
  registerAuth(app, () => service);
  app.use((err, req, res, _next) =>
    res.status(err.status || 500).json({ error: { code: err.code || "INTERNAL", message: err.expose ? err.message : "Internal error" } }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, cookie) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { call, close: () => server.close() };
}

test("http: sign up, me, log out, log in, with an HttpOnly cookie", async () => {
  const { auth } = await fresh();
  const { call, close } = await serve(auth);
  try {
    let res = await call("/api/auth/signup", good);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { user: { phone: "•••• 1234" } });
    const setCookie = res.headers.get("set-cookie");
    assert.match(setCookie, /^sd_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800$/);
    const cookie = setCookie.split(";")[0];

    assert.deepEqual(await (await call("/api/auth/me", undefined, cookie)).json(), { user: { phone: "•••• 1234" } });
    assert.deepEqual(await (await call("/api/auth/me")).json(), { user: null });

    res = await call("/api/auth/logout", {}, cookie);
    assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
    assert.deepEqual(await (await call("/api/auth/me", undefined, cookie)).json(), { user: null });

    res = await call("/api/auth/login", { email: good.email, password: "nope nope" });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, "INVALID_LOGIN");
    res = await call("/api/auth/login", { email: good.email, password: good.password });
    assert.equal(res.status, 200);
    const body = JSON.stringify(await res.json());
    assert.ok(!body.includes("grandma") && !body.includes("7805551234"));
  } finally {
    close();
  }
});

test("http: too many attempts are slowed down", async () => {
  const { auth } = await fresh();
  const { call, close } = await serve(auth);
  try {
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await call("/api/auth/login", { email: "x@y.co", password: "wrong one" })).status);
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
    assert.equal(codes[10], 429);
  } finally {
    close();
  }
});

test("http: without a database, accounts answer AUTH_DISABLED and me says logged out", async () => {
  const { call, close } = await serve(null);
  try {
    const res = await call("/api/auth/signup", good);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, "AUTH_DISABLED");
    assert.deepEqual(await (await call("/api/auth/me")).json(), { user: null });
  } finally {
    close();
  }
});

test("http: account POSTs must be JSON (no login CSRF from plain forms), bad JSON is a clean 400", async () => {
  const { auth } = await fresh();
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false })); // like server.js
  registerAuth(app, () => auth);
  app.use((err, req, res, _next) =>
    res.status(err.status || 500).json({ error: { code: err.code || "INTERNAL", message: err.expose ? err.message : "Internal error" } }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await auth.signUp(good);
    const form = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=grandma%40example.com&password=correct+horse",
    });
    assert.equal(form.status, 400);
    assert.equal(form.headers.get("set-cookie"), null);
    const logout = await fetch(`${base}/api/auth/logout`, { method: "POST" });
    assert.equal(logout.status, 400);
    const broken = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" });
    assert.equal(broken.status, 400);
    assert.deepEqual(await broken.json(), { error: { code: "BAD_REQUEST", message: "Please send valid JSON." } });
  } finally {
    server.close();
  }
});
