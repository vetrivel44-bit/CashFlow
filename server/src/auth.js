import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { audit } from "./db.js";
import { unauthorized, forbidden, bad } from "./http.js";

/**
 * Login is a PIN, not a password.
 *
 * The owner does not type. A 4-to-6 digit PIN can be entered on the same
 * number pad he already uses, and nothing else in the app asks him for
 * characters. Staff use the same mechanism so there is one login flow to
 * support, not two.
 *
 * A short PIN is only safe if guessing is slow and bounded, so:
 *   - it is stretched with scrypt, not hashed;
 *   - failures are counted per user and lock the account for a while;
 *   - a successful login issues a long random device token, and the PIN is
 *     never sent again.
 */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const MAX_FAILURES = 5;
const LOCK_MS = 10 * 60 * 1000;

const failures = new Map(); // userId -> { count, until }

export function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(pin), salt, SCRYPT.keylen, SCRYPT).toString("hex");
  return { salt, hash };
}

function pinMatches(pin, salt, expectedHex) {
  const got = scryptSync(String(pin), salt, SCRYPT.keylen, SCRYPT);
  const want = Buffer.from(expectedHex, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");

export function validPinFormat(pin) {
  return typeof pin === "string" && /^\d{4,6}$/.test(pin);
}

export function createUser(db, { name, role, pin }) {
  if (!name || typeof name !== "string") { throw bad("name_required", "Give the user a name."); }
  if (role !== "owner" && role !== "staff") { throw bad("bad_role", "Role must be owner or staff."); }
  if (!validPinFormat(pin)) { throw bad("bad_pin", "The PIN must be 4 to 6 digits."); }
  const { salt, hash } = hashPin(pin);
  const id = randomUUID();
  db.prepare(
    "INSERT INTO users (id, name, role, pin_salt, pin_hash, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
  ).run(id, name.trim(), role, salt, hash, Date.now());
  return { id, name: name.trim(), role };
}

export function setPin(db, userId, pin) {
  if (!validPinFormat(pin)) { throw bad("bad_pin", "The PIN must be 4 to 6 digits."); }
  const { salt, hash } = hashPin(pin);
  db.prepare("UPDATE users SET pin_salt = ?, pin_hash = ? WHERE id = ?").run(salt, hash, userId);
  failures.delete(userId);
}

/** Returns { token, device, user }. The token is shown once and never stored in the clear. */
export function login(db, { userId, pin, label = "" }) {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(userId);

  const state = failures.get(userId);
  if (state && state.until > Date.now()) {
    throw unauthorized("Too many wrong PINs. Try again in a few minutes.");
  }

  // Run the comparison even when the user is missing, so a wrong id and a
  // wrong PIN take the same time and neither can be told apart from outside.
  const ok = user
    ? pinMatches(pin, user.pin_salt, user.pin_hash)
    : (scryptSync(String(pin ?? ""), "decoy", SCRYPT.keylen, SCRYPT), false);

  if (!ok) {
    const count = (state?.count ?? 0) + 1;
    failures.set(userId, { count, until: count >= MAX_FAILURES ? Date.now() + LOCK_MS : 0 });
    audit(db, { userId: userId ?? "", action: "login_failed" });
    throw unauthorized("That PIN is not right.");
  }

  failures.delete(userId);
  const token = randomBytes(32).toString("hex");
  const device = {
    id: randomUUID(),
    user_id: user.id,
    label: String(label).slice(0, 60),
    token_hash: tokenHash(token),
    created_at: Date.now(),
    last_seen: Date.now()
  };
  db.prepare(
    "INSERT INTO devices (id, user_id, label, token_hash, created_at, last_seen, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)"
  ).run(device.id, device.user_id, device.label, device.token_hash, device.created_at, device.last_seen);
  audit(db, { userId: user.id, deviceId: device.id, action: "login", detail: device.label });

  return { token, device: { id: device.id, label: device.label }, user: { id: user.id, name: user.name, role: user.role } };
}

export function revokeDevice(db, deviceId) {
  db.prepare("UPDATE devices SET revoked = 1 WHERE id = ?").run(deviceId);
}

/** Resolve the Authorization header to { user, device }, or throw 401. */
export function authenticate(db, req) {
  const header = req.headers["authorization"] ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) { throw unauthorized("Sign in first."); }

  const device = db.prepare("SELECT * FROM devices WHERE token_hash = ? AND revoked = 0").get(tokenHash(token));
  if (!device) { throw unauthorized("This phone is signed out."); }

  const user = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(device.user_id);
  if (!user) { throw unauthorized("This account is closed."); }

  db.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").run(Date.now(), device.id);
  return { user: { id: user.id, name: user.name, role: user.role }, device: { id: device.id, label: device.label } };
}

/**
 * The owner's phone is view-only, and that is enforced here rather than by
 * hiding buttons. A read-only role on the server is the difference between a
 * design decision and a guarantee.
 */
export function requireStaff(ctx) {
  if (ctx.user.role !== "staff") {
    throw forbidden("The owner's phone can read the ledger but not change it.");
  }
}
