// Sign up, log in, sessions. No HTTP here, so it is easy to test.
// Never log or return an email, password, or full phone number.
import { createHash, randomBytes } from "node:crypto";
import { hashEmail, hashPassword, verifyPassword, normalizeEmail, DUMMY_HASH } from "./hashing.js";
import { emailSecret } from "./db.js";

export const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

export class AuthError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
    this.expose = true;
  }
}

const bad = (message) => new AuthError("BAD_REQUEST", 400, message);

/** "+1 (780) 555-1234" -> "+17805551234". A 10-digit number is treated as North American. */
export function normalizePhone(phone) {
  const raw = String(phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** "+17805551234" -> "•••• 1234" (SPEC §5.10: the browser only sees masked numbers). */
export function maskPhone(phone) {
  return `•••• ${String(phone ?? "").slice(-4)}`;
}

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");

export function createAuthService(db, { now = () => Date.now(), env = process.env } = {}) {
  const secret = emailSecret(db, env);
  const q = {
    userByEmail: db.prepare("SELECT id, password_hash FROM users WHERE email_hash = ?"),
    insertUser: db.prepare("INSERT INTO users (email_hash, password_hash, phone) VALUES (?, ?, ?)"),
    insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"),
    sessionUser: db.prepare(
      "SELECT u.id, u.phone FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
    ),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    deleteExpired: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
  };

  function startSession(userId) {
    q.deleteExpired.run(now());
    const token = randomBytes(32).toString("base64url");
    const expiresAt = now() + SESSION_MS;
    q.insertSession.run(tokenHash(token), userId, expiresAt);
    return { token, expiresAt };
  }

  return {
    async signUp({ email, password, phone } = {}) {
      if (!EMAIL_RE.test(normalizeEmail(email))) throw bad("Please enter a valid email address.");
      if (typeof password !== "string" || password.length < PASSWORD_MIN)
        throw bad(`Your password needs at least ${PASSWORD_MIN} characters.`);
      if (password.length > PASSWORD_MAX) throw bad("That password is too long.");
      const cleanPhone = normalizePhone(phone);
      if (!cleanPhone) throw bad("Please enter a valid phone number, like 780 555 1234.");

      const emailHash = hashEmail(email, secret);
      if (q.userByEmail.get(emailHash)) {
        throw new AuthError("EMAIL_TAKEN", 409, "An account with that email already exists. Try logging in.");
      }
      const passwordHash = await hashPassword(password);
      let id;
      try {
        id = Number(q.insertUser.run(emailHash, passwordHash, cleanPhone).lastInsertRowid);
      } catch (err) {
        // Two sign-ups for the same email at once: the UNIQUE constraint catches the second.
        if (/UNIQUE/i.test(String(err?.message)))
          throw new AuthError("EMAIL_TAKEN", 409, "An account with that email already exists. Try logging in.");
        throw err;
      }
      return { user: { id, phone: maskPhone(cleanPhone) }, session: startSession(id) };
    },

    async logIn({ email, password } = {}) {
      if (typeof email !== "string" || typeof password !== "string" || !email || !password)
        throw bad("Please enter your email and password.");
      const row = q.userByEmail.get(hashEmail(email, secret));
      // Always run scrypt, so a missing account and a wrong password take the same time.
      const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) throw new AuthError("INVALID_LOGIN", 401, "That email and password don't match.");
      const session = startSession(row.id);
      return { user: this.userForToken(session.token), session };
    },

    /** The logged-in user for a session token, or null. Phone is masked. */
    userForToken(token) {
      if (typeof token !== "string" || !token) return null;
      const row = q.sessionUser.get(tokenHash(token), now());
      return row ? { id: row.id, phone: maskPhone(row.phone) } : null;
    },

    logOut(token) {
      if (typeof token === "string" && token) q.deleteSession.run(tokenHash(token));
    },
  };
}
