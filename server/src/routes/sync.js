import { nextSeq, currentSeq, audit, tx } from "../db.js";
import { requireStaff } from "../auth.js";
import { bad } from "../http.js";

/**
 * Sync.
 *
 * The delivery areas have poor network, so the phones are the source of truth
 * for what happened and the server is the place they agree. Two properties
 * make that safe without any conflict resolution UI:
 *
 *   1. Entries are immutable and carry a client-generated id. Pushing the same
 *      entry twice is a no-op, so a phone that loses signal mid-push can retry
 *      the whole batch forever and never double-count a payment.
 *
 *   2. Balances are derived, never synced. Two phones cannot disagree about a
 *      total, because neither of them stores one.
 *
 * Only shops and routes are mutable, and they are last-write-wins on
 * updated_at. A rename racing a rename is the worst case, and the loser is
 * visible in the audit table.
 */

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const ID_RX = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_AMOUNT = 10_000_000;      // ₹1 crore on one entry is a typo, not a delivery
const MAX_BATCH = 500;
const PAST_LIMIT_DAYS = 365 * 5;    // opening balances can be dated back, but not to 1998
const FUTURE_LIMIT_DAYS = 1;        // a device clock may be a few hours ahead

const today = () => new Date().toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

function checkDate(value) {
  if (!DATE_RX.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z"))) {
    throw bad("bad_date", "A date must look like 2026-09-17.");
  }
  const delta = dayDiff(value, today());
  if (delta < -FUTURE_LIMIT_DAYS) { throw bad("future_date", "That date is in the future."); }
  if (delta > PAST_LIMIT_DAYS) { throw bad("ancient_date", "That date is too far back to be real."); }
  return value;
}

function checkId(value, what) {
  if (typeof value !== "string" || !ID_RX.test(value)) {
    throw bad("bad_id", `The ${what} id is not in a form this server accepts.`);
  }
  return value;
}

function checkAmount(value) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_AMOUNT) {
    throw bad("bad_amount", "An amount must be a whole number of rupees, more than zero.");
  }
  return value;
}

function checkName(value, what) {
  const s = String(value ?? "").trim();
  if (!s) { throw bad("name_required", `The ${what} needs a name.`); }
  if (s.length > 80) { throw bad("name_too_long", `That ${what} name is too long.`); }
  return s;
}

function checkPhone(value) {
  const s = String(value ?? "").replace(/\D/g, "");
  if (s === "") { return ""; }
  if (s.length !== 10) { throw bad("bad_phone", "A WhatsApp number is 10 digits."); }
  return s;
}

/** GET /api/sync?since=N — everything written after N, in write order. */
export function pull(db, ctx, query) {
  const since = Number(query.get("since") ?? 0);
  if (!Number.isInteger(since) || since < 0) {
    throw bad("bad_since", "`since` must be a whole number.");
  }
  const rows = (sql) => db.prepare(sql).all(since);
  return {
    seq: currentSeq(db),
    routes: rows("SELECT id, name, updated_at, seq FROM routes WHERE seq > ? ORDER BY seq"),
    shops: rows(
      "SELECT id, name, phone, route_id, archived, reminded_on, updated_at, seq FROM shops WHERE seq > ? ORDER BY seq"
    ),
    entries: rows(
      `SELECT id, shop_id, kind, amount, entry_date, reversed_by, reversal_of,
              created_at, created_by, device_id, seq
         FROM entries WHERE seq > ? ORDER BY seq`
    )
  };
}

/**
 * POST /api/sync — push a batch of local changes.
 *
 * Returns a per-item result rather than failing the whole batch, so one bad
 * row (a shop deleted on another phone, an amount that overflowed) never
 * blocks the eleven good ones behind it. The client keeps retrying anything
 * that is not `ok` or `duplicate`.
 */
export function push(db, ctx, body) {
  requireStaff(ctx);

  const routes = body.routes ?? [];
  const shops = body.shops ?? [];
  const entries = body.entries ?? [];
  const reversals = body.reversals ?? [];

  const total = routes.length + shops.length + entries.length + reversals.length;
  if (total > MAX_BATCH) {
    throw bad("batch_too_large", `Send at most ${MAX_BATCH} changes at a time.`);
  }

  const results = [];
  const note = (kind, id, status, reason) => results.push(reason ? { kind, id, status, reason } : { kind, id, status });

  tx(db, () => {
    for (const r of routes) { note("route", r.id, applyRoute(db, ctx, r)); }
    for (const s of shops) { note("shop", s.id, applyShop(db, ctx, s)); }

    // Entries before reversals: a correction and the entry it corrects can
    // arrive in the same batch, and the correction has to exist first.
    for (const e of entries) {
      try { note("entry", e.id, applyEntry(db, ctx, e)); }
      catch (err) { note("entry", e?.id ?? "", "rejected", err.code ?? "invalid"); }
    }
    for (const r of reversals) {
      try { note("reversal", r.id, applyReversal(db, ctx, r)); }
      catch (err) { note("reversal", r?.id ?? "", "rejected", err.code ?? "invalid"); }
    }

    audit(db, {
      userId: ctx.user.id, deviceId: ctx.device.id, action: "sync_push",
      detail: `${results.filter((x) => x.status === "ok").length} applied of ${total}`
    });
  });

  return { seq: currentSeq(db), results };
}

function applyRoute(db, ctx, r) {
  const id = checkId(r.id, "route");
  const name = checkName(r.name, "route");
  const updatedAt = Number(r.updated_at) || Date.now();
  const existing = db.prepare("SELECT updated_at FROM routes WHERE id = ?").get(id);
  if (existing && existing.updated_at >= updatedAt) { return "stale"; }
  const seq = nextSeq(db);
  if (existing) {
    db.prepare("UPDATE routes SET name = ?, updated_at = ?, updated_by = ?, seq = ? WHERE id = ?")
      .run(name, updatedAt, ctx.user.id, seq, id);
  } else {
    db.prepare("INSERT INTO routes (id, name, updated_at, updated_by, seq) VALUES (?, ?, ?, ?, ?)")
      .run(id, name, updatedAt, ctx.user.id, seq);
  }
  return "ok";
}

function applyShop(db, ctx, s) {
  const id = checkId(s.id, "shop");
  const name = checkName(s.name, "shop");
  const phone = checkPhone(s.phone);
  const routeId = checkId(s.route_id, "route");
  if (!db.prepare("SELECT 1 FROM routes WHERE id = ?").get(routeId)) {
    throw bad("unknown_route", "That route is not on this server yet.");
  }
  const archived = s.archived ? 1 : 0;
  const remindedOn = s.reminded_on ? checkDate(s.reminded_on) : null;
  const updatedAt = Number(s.updated_at) || Date.now();

  const existing = db.prepare("SELECT updated_at FROM shops WHERE id = ?").get(id);
  if (existing && existing.updated_at >= updatedAt) { return "stale"; }
  const seq = nextSeq(db);
  if (existing) {
    db.prepare(
      `UPDATE shops SET name = ?, phone = ?, route_id = ?, archived = ?, reminded_on = ?,
              updated_at = ?, updated_by = ?, seq = ? WHERE id = ?`
    ).run(name, phone, routeId, archived, remindedOn, updatedAt, ctx.user.id, seq, id);
  } else {
    db.prepare(
      `INSERT INTO shops (id, name, phone, route_id, archived, reminded_on, updated_at, updated_by, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, phone, routeId, archived, remindedOn, updatedAt, ctx.user.id, seq);
  }
  return "ok";
}

function applyEntry(db, ctx, e) {
  const id = checkId(e.id, "entry");

  // Idempotent by id. This is the property that makes retrying a whole batch
  // over a bad connection safe, and it is why payments cannot be double-counted.
  if (db.prepare("SELECT 1 FROM entries WHERE id = ?").get(id)) { return "duplicate"; }

  const shopId = checkId(e.shop_id, "shop");
  if (!db.prepare("SELECT 1 FROM shops WHERE id = ?").get(shopId)) {
    throw bad("unknown_shop", "That shop is not on this server yet.");
  }
  if (!["opening", "delivery", "payment"].includes(e.kind)) {
    throw bad("bad_kind", "An entry is an opening balance, a delivery or a payment.");
  }
  const amount = checkAmount(e.amount);
  const entryDate = checkDate(e.entry_date);

  let reversalOf = null;
  if (e.reversal_of) {
    reversalOf = checkId(e.reversal_of, "entry");
    const target = db.prepare("SELECT id, amount, kind FROM entries WHERE id = ?").get(reversalOf);
    if (!target) { throw bad("unknown_entry", "The entry being corrected is not on this server."); }
    if (target.amount !== amount) { throw bad("reversal_mismatch", "A correction must be for the same amount."); }
  }

  const seq = nextSeq(db);
  db.prepare(
    `INSERT INTO entries (id, shop_id, kind, amount, entry_date, reversed_by, reversal_of,
                          created_at, created_by, device_id, seq)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
  ).run(id, shopId, e.kind, amount, entryDate, reversalOf, Number(e.created_at) || Date.now(), ctx.user.id, ctx.device.id, seq);
  return "ok";
}

/**
 * Mark an entry reversed. This is the only field on an entry that can ever
 * change, it can only go from empty to set, and it can only be set once —
 * so an entry can never be quietly rewritten, and the history always shows
 * both the mistake and the correction.
 */
function applyReversal(db, ctx, r) {
  const id = checkId(r.id, "entry");
  const by = checkId(r.reversed_by, "entry");

  const entry = db.prepare("SELECT id, reversed_by FROM entries WHERE id = ?").get(id);
  if (!entry) { throw bad("unknown_entry", "That entry is not on this server."); }
  if (entry.reversed_by) { return entry.reversed_by === by ? "duplicate" : "already_reversed"; }
  if (!db.prepare("SELECT 1 FROM entries WHERE id = ?").get(by)) {
    throw bad("unknown_entry", "The correcting entry has not arrived yet.");
  }

  const seq = nextSeq(db);
  db.prepare("UPDATE entries SET reversed_by = ?, seq = ? WHERE id = ?").run(by, seq, id);
  audit(db, { userId: ctx.user.id, deviceId: ctx.device.id, action: "reverse_entry", detail: `${id} by ${by}` });
  return "ok";
}
