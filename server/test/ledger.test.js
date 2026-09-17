import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balanceOf, oldestUnpaidDate, daysOutstanding, collectedOn, deliveredOn,
  outstandingList, groupByShop, groupDigits, live
} from "../src/ledger.js";

let n = 0;
const e = (kind, amount, date, extra = {}) => ({
  id: "e" + ++n, shop_id: "s1", kind, amount, entry_date: date,
  reversed_by: null, reversal_of: null, seq: n, ...extra
});

test("a delivery increases what is owed, a payment reduces it", () => {
  const es = [e("delivery", 6200, "2026-09-03"), e("payment", 3000, "2026-09-17")];
  assert.equal(balanceOf(es), 3200);
});

test("an opening balance counts as owed, like a delivery", () => {
  assert.equal(balanceOf([e("opening", 18000, "2026-08-22")]), 18000);
});

test("a reversed entry stays on the record but is not money", () => {
  const payment = e("payment", 2000, "2026-09-17");
  const correction = e("delivery", 2000, "2026-09-17", { reversal_of: payment.id });
  payment.reversed_by = correction.id;

  const es = [e("delivery", 5000, "2026-09-01"), payment, correction];
  assert.equal(balanceOf(es), 5000, "the payment and its correction cancel out");
  assert.equal(es.length, 3, "nothing was removed");
  assert.equal(live(es).length, 1, "and neither half of the correction is money");
});

test("payments settle the oldest delivery first", () => {
  // Two deliveries, and a payment that covers the older one exactly.
  const es = [
    e("delivery", 5000, "2026-08-01"),
    e("delivery", 9000, "2026-09-10"),
    e("payment", 5000, "2026-09-15")
  ];
  assert.equal(oldestUnpaidDate(es), "2026-09-10",
    "the August delivery is settled, so the age comes from September");
  assert.equal(daysOutstanding(es, "2026-09-17"), 7);
});

test("a part payment does not reset the age of the old bill", () => {
  const es = [
    e("delivery", 10000, "2026-08-01"),
    e("payment", 4000, "2026-09-15")
  ];
  assert.equal(oldestUnpaidDate(es), "2026-08-01");
  assert.equal(daysOutstanding(es, "2026-09-17"), 47);
});

test("a settled shop has no age at all", () => {
  const es = [e("delivery", 12000, "2026-08-18"), e("payment", 12000, "2026-09-15")];
  assert.equal(balanceOf(es), 0);
  assert.equal(oldestUnpaidDate(es), null);
  assert.equal(daysOutstanding(es, "2026-09-17"), null);
});

test("collected today counts payments only, and never a reversed one", () => {
  const reversed = e("payment", 800, "2026-09-17");
  reversed.reversed_by = "x";
  const es = [
    e("payment", 3000, "2026-09-17"),
    e("payment", 1200, "2026-09-17"),
    e("delivery", 9000, "2026-09-17"),
    e("payment", 5050, "2026-09-11"),
    reversed
  ];
  assert.equal(collectedOn(es, "2026-09-17"), 4200);
  assert.equal(deliveredOn(es, "2026-09-17"), 9000);
});

test("the outstanding list is worst-overdue first and drops settled shops", () => {
  const shops = [
    { id: "a", name: "A", archived: 0 },
    { id: "b", name: "B", archived: 0 },
    { id: "c", name: "C", archived: 0 },
    { id: "z", name: "Z", archived: 1 }
  ];
  const entries = [
    { id: "1", shop_id: "a", kind: "delivery", amount: 1000, entry_date: "2026-09-10", reversed_by: null, seq: 1 },
    { id: "2", shop_id: "b", kind: "delivery", amount: 2000, entry_date: "2026-08-01", reversed_by: null, seq: 2 },
    { id: "3", shop_id: "c", kind: "delivery", amount: 3000, entry_date: "2026-07-01", reversed_by: null, seq: 3 },
    { id: "4", shop_id: "c", kind: "payment", amount: 3000, entry_date: "2026-09-16", reversed_by: null, seq: 4 },
    { id: "5", shop_id: "z", kind: "delivery", amount: 9999, entry_date: "2026-01-01", reversed_by: null, seq: 5 }
  ];
  const rows = outstandingList(shops, groupByShop(entries), "2026-09-17");

  assert.deepEqual(rows.map((r) => r.shop.id), ["b", "a"], "C is settled and Z is archived");
  assert.equal(rows[0].days, 47);
  assert.equal(rows[1].days, 7);
});

test("amounts group the Indian way", () => {
  assert.equal(groupDigits(500), "500");
  assert.equal(groupDigits(48400), "48,400");
  assert.equal(groupDigits(184000), "1,84,000");
  assert.equal(groupDigits(28450000), "2,84,50,000");
});
