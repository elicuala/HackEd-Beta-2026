// Hashing for accounts. Emails and passwords are never stored as they were typed.
//
// - Email: HMAC-SHA256 with a server secret. The same email always gives the same hash, so we can
//   find the account at login, but the database alone can't be turned back into email addresses.
// - Password: scrypt with a random salt per user. Slow on purpose, so leaked hashes are hard to crack.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

export function hashEmail(email, secret) {
  return createHmac("sha256", secret).update(normalizeEmail(email)).digest("hex");
}

/** Returns "scrypt$<salt hex>$<hash hex>". */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password), salt, KEY_LEN, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored ?? "").split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scryptAsync(String(password), Buffer.from(saltHex, "hex"), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

/** A stored hash to compare against when the email doesn't exist, so a wrong email takes as long as a wrong password. */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));
