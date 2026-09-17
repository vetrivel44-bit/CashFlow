import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(path) {
  if (path !== ":memory:") { mkdirSync(dirname(path), { recursive: true }); }
  const db = new DatabaseSync(path);
  db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
  return db;
}

/**
 * Take the next change sequence number.
 *
 * Every write stamps its row with one of these. A client pulls with
 * `?since=N` and gets exactly the rows it has not seen, in write order.
 * Sequence numbers rather than timestamps: two phones with wrong clocks
 * still agree on the order the server accepted things in.
 */
export function nextSeq(db) {
  db.prepare("UPDATE change_seq SET val = val + 1 WHERE id = 1").run();
  return db.prepare("SELECT val FROM change_seq WHERE id = 1").get().val;
}

export function currentSeq(db) {
  return db.prepare("SELECT val FROM change_seq WHERE id = 1").get().val;
}

export function audit(db, { userId = "", deviceId = "", action, detail = "" }) {
  db.prepare(
    "INSERT INTO audit (at, user_id, device_id, action, detail) VALUES (?, ?, ?, ?, ?)"
  ).run(Date.now(), userId, deviceId, action, typeof detail === "string" ? detail : JSON.stringify(detail));
}

/** Run fn inside a transaction, rolling back if it throws. */
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
}
