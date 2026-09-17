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

export function getSetting(db, key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, String(value));
}

export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const out = fn(); db.exec("COMMIT"); return out; }
  catch (err) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw err; }
}

/** Everything the analysis needs, in one read. */
export function loadAll(db) {
  return {
    openingBalance: Number(getSetting(db, "opening_balance", "0")),
    transactions: db.prepare("SELECT * FROM transactions ORDER BY date").all(),
    invoices: db.prepare("SELECT * FROM invoices ORDER BY due_date").all(),
    scheduled: db.prepare("SELECT * FROM scheduled_payments ORDER BY due_date").all()
  };
}
