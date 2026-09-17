import { outstandingList, groupByShop, collectedOn, deliveredOn, balanceOf, daysOutstanding, live } from "../../../shared/ledger.js";
import { buildXlsx, buildCsv } from "../xlsx.js";
import { bad } from "../http.js";

/**
 * Reports are computed from the entry table on every request. Nothing is
 * cached and no total is stored, so a report can never be stale or disagree
 * with the screen that asked for it.
 *
 * Every report includes every shop that owes money. There is no filter, no
 * "exclude from reports" flag and no way to hide a row — not as an oversight,
 * as a rule. See docs/BOUNDARIES.md.
 */

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

function asOfFrom(query) {
  const raw = query.get("as_of") ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RX.test(raw)) { throw bad("bad_date", "as_of must look like 2026-09-17."); }
  return raw;
}

function loadAll(db) {
  const shops = db.prepare("SELECT * FROM shops ORDER BY name").all();
  const entries = db.prepare("SELECT * FROM entries").all();
  const routes = new Map(db.prepare("SELECT id, name FROM routes").all().map((r) => [r.id, r.name]));
  return { shops, entries, byShop: groupByShop(entries), routes };
}

export function outstanding(db, ctx, query) {
  const asOf = asOfFrom(query);
  const { shops, byShop, routes } = loadAll(db);
  const rows = outstandingList(shops, byShop, asOf);
  return {
    as_of: asOf,
    total: rows.reduce((s, r) => s + r.balance, 0),
    shop_count: rows.length,
    rows: rows.map((r) => ({
      shop_id: r.shop.id,
      name: r.shop.name,
      route: routes.get(r.shop.route_id) ?? "",
      phone: r.shop.phone,
      days: r.days,
      balance: r.balance
    }))
  };
}

/** The daily one-page sheet, as data. The client lays it out and prints it. */
export function printSheet(db, ctx, query) {
  const asOf = asOfFrom(query);
  const report = outstanding(db, ctx, query);
  const { entries } = loadAll(db);
  return { ...report, collected_today: collectedOn(entries, asOf) };
}

export function dayClose(db, ctx, query) {
  const date = asOfFrom(query);
  const { entries, shops } = loadAll(db);
  const names = new Map(shops.map((s) => [s.id, s.name]));
  const ofDay = entries.filter((e) => e.entry_date === date);
  return {
    date,
    collected: collectedOn(entries, date),
    delivered: deliveredOn(entries, date),
    payment_count: live(ofDay).filter((e) => e.kind === "payment").length,
    entries: ofDay
      .sort((a, b) => b.seq - a.seq)
      .map((e) => ({
        id: e.id, shop: names.get(e.shop_id) ?? "", kind: e.kind, amount: e.amount,
        reversed: Boolean(e.reversed_by), is_reversal: Boolean(e.reversal_of),
        created_by: e.created_by, device_id: e.device_id
      }))
  };
}

/** One shop's full history, with the running balance after each entry. */
export function shopLedger(db, ctx, params, query) {
  const asOf = asOfFrom(query);
  const shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(params.shopId);
  if (!shop) { throw bad("unknown_shop", "No such shop."); }
  const rows = db.prepare("SELECT * FROM entries WHERE shop_id = ? ORDER BY entry_date, seq").all(shop.id);

  let running = 0;
  const history = rows.map((e) => {
    // Same rule as ledger.live(): neither half of a correction is money.
    if (!e.reversed_by && !e.reversal_of) {
      running += e.kind === "payment" ? -e.amount : e.amount;
    }
    return {
      id: e.id, kind: e.kind, amount: e.amount, date: e.entry_date,
      balance_after: running,
      reversed: Boolean(e.reversed_by), is_reversal: Boolean(e.reversal_of),
      created_by: e.created_by
    };
  });

  return {
    shop: { id: shop.id, name: shop.name, phone: shop.phone, route_id: shop.route_id, archived: Boolean(shop.archived) },
    balance: balanceOf(rows),
    days: daysOutstanding(rows, asOf),
    history: history.reverse()
  };
}

function exportRows(db, ctx, query) {
  const report = outstanding(db, ctx, query);
  const header = ["Shop", "Route", "WhatsApp", "Days outstanding", "Amount"];
  const body = report.rows.map((r) => [r.name, r.route, r.phone, r.days, r.balance]);
  const total = ["Total", "", "", "", report.total];
  return { report, rows: [header, ...body, total] };
}

export function exportXlsx(db, ctx, query) {
  const { report, rows } = exportRows(db, ctx, query);
  return {
    body: buildXlsx("Outstanding " + report.as_of, rows, [28, 18, 14, 18, 14]),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename: `outstanding-${report.as_of}.xlsx`
  };
}

export function exportCsv(db, ctx, query) {
  const { report, rows } = exportRows(db, ctx, query);
  return {
    body: buildCsv(rows),
    contentType: "text/csv; charset=utf-8",
    filename: `outstanding-${report.as_of}.csv`
  };
}

/**
 * The whole ledger as one file, for the nightly backup to the owner's own
 * Google Drive. Deliberately everything, in a plain format anyone can read
 * with no software from us: if this project disappears tomorrow, this file is
 * still his accounts.
 */
export function backupJson(db) {
  return {
    format: "cashflow-ledger-backup",
    version: 1,
    exported_at: new Date().toISOString(),
    routes: db.prepare("SELECT * FROM routes ORDER BY seq").all(),
    shops: db.prepare("SELECT * FROM shops ORDER BY seq").all(),
    entries: db.prepare("SELECT * FROM entries ORDER BY seq").all()
  };
}
