/**
 * Ledger arithmetic.
 *
 * Every number the app shows is derived here from the entry list. Nothing is
 * stored as a running total, so the owner's phone, the staff phone, the printed
 * sheet and the export cannot drift apart — they are four readings of one
 * calculation.
 *
 * The one business rule worth stating out loud:
 *
 *   Payments settle the oldest unpaid delivery first.
 *
 * That is how the trade actually settles. It means a shop that pays part of an
 * old bill gets credit for its age, and a shop that pays for this week's goods
 * while last month's sit unpaid does not get its day count reset.
 */

/** Deliveries and opening balances increase what is owed; payments reduce it. */
export function isDebit(entry) {
  return entry.kind === "delivery" || entry.kind === "opening";
}

/**
 * Entries that still count as money.
 *
 * A correction is two rows: the entry that was wrong, now carrying
 * `reversed_by`, and the entry that cancels it, carrying `reversal_of`.
 * BOTH stay on the record for ever, and NEITHER counts — the pair nets to
 * nothing, which is the whole point of a reversal.
 *
 * Excluding only one of the two would cancel the mistake twice. That is worth
 * a comment because it is an easy thing to get wrong, and getting it wrong
 * means a shop's balance moves in the wrong direction after an undo.
 */
export function live(entries) {
  return entries.filter((e) => !e.reversed_by && !e.reversal_of);
}

function byDate(a, b) {
  if (a.entry_date !== b.entry_date) { return a.entry_date < b.entry_date ? -1 : 1; }
  return a.seq - b.seq;
}

export function balanceOf(entries) {
  return live(entries).reduce((sum, e) => sum + (isDebit(e) ? e.amount : -e.amount), 0);
}

/**
 * The date of the oldest debit not yet covered by payments, or null when the
 * shop is square. This is what the day count on the owner's screen measures.
 */
export function oldestUnpaidDate(entries) {
  const es = live(entries).slice().sort(byDate);
  let pool = es.filter((e) => !isDebit(e)).reduce((s, e) => s + e.amount, 0);
  for (const e of es.filter(isDebit)) {
    if (pool >= e.amount) { pool -= e.amount; } else { return e.entry_date; }
  }
  return null;
}

/** Whole days between two 'YYYY-MM-DD' dates. */
export function dayDiff(fromISO, toISO) {
  const a = Date.parse(fromISO + "T00:00:00Z");
  const b = Date.parse(toISO + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

export function daysOutstanding(entries, asOf) {
  const d = oldestUnpaidDate(entries);
  return d === null ? null : dayDiff(d, asOf);
}

/**
 * The outstanding list, exactly as the owner's screen and the printed sheet
 * show it: only shops that owe something, worst overdue first, ties broken by
 * the larger amount.
 */
export function outstandingList(shops, entriesByShop, asOf) {
  return shops
    .filter((s) => !s.archived)
    .map((shop) => {
      const es = entriesByShop.get(shop.id) ?? [];
      return { shop, balance: balanceOf(es), days: daysOutstanding(es, asOf) };
    })
    .filter((r) => r.balance > 0)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0) || b.balance - a.balance);
}

/**
 * Cash taken in on one business date. Payments only — a delivery is not money,
 * and a reversed payment is money that is not in the bag.
 */
export function collectedOn(entries, date) {
  return live(entries)
    .filter((e) => e.kind === "payment" && e.entry_date === date)
    .reduce((s, e) => s + e.amount, 0);
}

export function deliveredOn(entries, date) {
  return live(entries)
    .filter((e) => e.kind === "delivery" && e.entry_date === date)
    .reduce((s, e) => s + e.amount, 0);
}

/** Group a flat entry list by shop, ready for the functions above. */
export function groupByShop(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.shop_id)) { map.set(e.shop_id, []); }
    map.get(e.shop_id).push(e);
  }
  return map;
}

/** Indian digit grouping, whole rupees: 184000 -> "1,84,000". */
export function groupDigits(n) {
  const s = String(Math.abs(Math.round(n)));
  if (s.length <= 3) { return s; }
  return s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + s.slice(-3);
}
