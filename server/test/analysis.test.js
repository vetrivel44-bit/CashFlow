import { test } from "node:test";
import assert from "node:assert/strict";

import { addDays, parseDate, group, toRupees, median } from "../../shared/money.js";
import { buildSeries, forecastAll, detectRecurring, typicalCollectionDelay } from "../../shared/forecast.js";
import { ageInvoices, bucketFor, draftReminder } from "../../shared/invoices.js";
import { assessRisk } from "../../shared/risk.js";
import { optimize, isShiftable, NEVER_SHIFT } from "../../shared/optimizer.js";
import { importTransactions, importInvoices, parseCsv } from "../src/csv.js";

const TODAY = "2026-06-15";
const d = (n) => addDays(TODAY, n);

// ----------------------------------------------------------------- money ---

test("amounts group the Indian way", () => {
  assert.equal(group(500), "500");
  assert.equal(group(48400), "48,400");
  assert.equal(group(1840000), "18,40,000");
  assert.equal(group(-125000), "-1,25,000");
});

test("rupee strings from a spreadsheet are read, brackets meaning negative", () => {
  assert.equal(toRupees("₹1,25,000"), 125000);
  assert.equal(toRupees("(4,500)"), -4500);
  assert.equal(toRupees("banana"), null);
});

test("Indian date formats are read, and ambiguous US ones are not guessed", () => {
  assert.equal(parseDate("15-06-2026"), "2026-06-15");
  assert.equal(parseDate("15/06/2026"), "2026-06-15");
  assert.equal(parseDate("2026-06-15"), "2026-06-15");
  // 03/04/2026 is 3 April, read as day-first. Never silently 4 March.
  assert.equal(parseDate("03/04/2026"), "2026-04-03");
  assert.equal(parseDate("not a date"), null);
});

// -------------------------------------------------------------- forecast ---

test("a payment due inside the horizon lowers the balance on its day", () => {
  const s = buildSeries({
    openingBalance: 100000,
    scheduled: [{ id: "p1", label: "Rent", category: "rent", amount: 40000, due_date: d(10) }],
    asOf: TODAY
  });
  assert.equal(s.days[9].balance, 100000, "untouched the day before");
  assert.equal(s.days[10].balance, 60000, "and down by the payment on the day");
  assert.equal(s.minBalance, 60000);
});

test("an overdue invoice is expected from today, not from a due date that has passed", () => {
  const s = buildSeries({
    openingBalance: 0,
    invoices: [{ id: "i1", customer: "A", number: "1", due_date: d(-40), amount: 50000, paid_amount: 0 }],
    asOf: TODAY,
    collectionDelay: 10
  });
  const arrival = s.days.find((x) => x.inflow > 0);
  assert.equal(arrival.date, d(10), "40 days late does not mean it arrived 30 days ago");
});

test("the pessimistic case collects later and collects less", () => {
  const input = {
    openingBalance: 0,
    invoices: [{ id: "i1", customer: "A", number: "1", due_date: d(5), amount: 100000, paid_amount: 0 }],
    asOf: TODAY,
    collectionDelay: 7
  };
  const all = forecastAll(input);
  assert.equal(all.expected.closing, 100000);
  assert.equal(all.pessimistic.closing, 80000, "a fifth does not arrive this quarter");
  assert.ok(all.optimistic.closing >= all.expected.closing);
});

test("monthly costs are found in history and carried into the forecast", () => {
  const transactions = [];
  for (let m = 5; m >= 1; m--) {
    transactions.push({ date: addDays(TODAY, -m * 30), direction: "out", amount: 50000, category: "rent", counterparty: "Landlord" });
  }
  const found = detectRecurring(transactions, TODAY);
  assert.equal(found.length, 1);
  assert.equal(found[0].amount, 50000);
  assert.equal(found[0].direction, "out");

  const s = buildSeries({ openingBalance: 500000, recurring: found, asOf: TODAY });
  assert.ok(s.totalOut >= 150000, "three months of rent inside 90 days");
});

test("something that happened twice is not treated as monthly", () => {
  const transactions = [
    { date: addDays(TODAY, -60), direction: "out", amount: 9000, counterparty: "One off" },
    { date: addDays(TODAY, -30), direction: "out", amount: 9000, counterparty: "One off" }
  ];
  assert.equal(detectRecurring(transactions, TODAY).length, 0, "two points is not a pattern");
});

test("collection delay is learned from invoices that were actually paid", () => {
  const invoices = [
    { due_date: d(-60), paid_date: d(-50) },
    { due_date: d(-50), paid_date: d(-38) },
    { due_date: d(-40), paid_date: d(-26) }
  ];
  assert.equal(typicalCollectionDelay(invoices), 12);
  assert.equal(typicalCollectionDelay([]), 7, "no history: assume a week");
});

// -------------------------------------------------------------- invoices ---

test("ageing buckets split at 15 and 30 days, and not-yet-due is its own bucket", () => {
  assert.equal(bucketFor(0), "not_due");
  assert.equal(bucketFor(1), "d0_15");
  assert.equal(bucketFor(15), "d0_15");
  assert.equal(bucketFor(16), "d15_30");
  assert.equal(bucketFor(31), "d30_plus");

  const aged = ageInvoices([
    { id: "1", number: "A", customer: "X", issue_date: d(-40), due_date: d(5), amount: 10000 },
    { id: "2", number: "B", customer: "Y", issue_date: d(-40), due_date: d(-10), amount: 20000 },
    { id: "3", number: "C", customer: "Z", issue_date: d(-70), due_date: d(-40), amount: 30000 },
    { id: "4", number: "D", customer: "W", issue_date: d(-70), due_date: d(-40), amount: 5000, paid_amount: 5000 }
  ], TODAY);

  assert.equal(aged.rows.length, 3, "settled invoices drop out");
  assert.equal(aged.total, 60000);
  assert.equal(aged.overdueTotal, 50000, "the not-yet-due one is not overdue");
  assert.equal(aged.overdueCount, 2);
});

test("a part-paid invoice counts only what is still owed", () => {
  const aged = ageInvoices([{ id: "1", number: "A", customer: "X", issue_date: d(-40), due_date: d(-5), amount: 100000, paid_amount: 60000 }], TODAY);
  assert.equal(aged.total, 40000);
});

test("a reminder is drafted, never sent, and hardens with age", () => {
  const row = { number: "INV-1", customer: "Anand Auto", due_date: d(-45), outstanding: 200000, daysOverdue: 45 };
  const text = draftReminder(row, { business: "Kumaran Works" });
  assert.match(text, /Anand Auto/);
  assert.match(text, /45 days past due/);
  assert.match(text, /₹2,00,000/);
  assert.doesNotMatch(text, /legal|court|penalty/i, "it stays a business letter");
});

// ------------------------------------------------------------------ risk ---

test("running out of cash within a month is RED", () => {
  const forecasts = forecastAll({
    openingBalance: 50000,
    scheduled: [{ id: "p", label: "Big bill", category: "materials", amount: 200000, due_date: d(10) }],
    asOf: TODAY
  });
  const risk = assessRisk({ forecasts, invoices: [], asOf: TODAY, monthlyOutflow: 200000 });
  assert.equal(risk.level, "RED");
  assert.equal(risk.daysUntilNegative, 10);
  assert.ok(risk.reasons.length > 0, "and it says why");
});

test("surviving the expected case but not a slip is AMBER", () => {
  const forecasts = forecastAll({
    openingBalance: 200000,
    invoices: [{ id: "i", customer: "A", number: "1", due_date: d(20), amount: 300000, paid_amount: 0 }],
    scheduled: [{ id: "p", label: "Materials", category: "materials", amount: 400000, due_date: d(40) }],
    asOf: TODAY,
    collectionDelay: 5
  });
  const risk = assessRisk({ forecasts, invoices: [], asOf: TODAY, monthlyOutflow: 400000 });
  assert.equal(risk.level, "AMBER");
});

test("plenty of cash and no dip is GREEN", () => {
  const forecasts = forecastAll({ openingBalance: 5000000, scheduled: [], asOf: TODAY });
  const risk = assessRisk({ forecasts, invoices: [], asOf: TODAY, monthlyOutflow: 300000 });
  assert.equal(risk.level, "GREEN");
});

// ------------------------------------------------------------- optimizer ---

test("wages, tax and EMI are never shiftable, whatever the data says", () => {
  for (const category of ["salary", "wages", "payroll", "tax", "gst", "tds", "loan_emi", "emi"]) {
    assert.equal(isShiftable({ category, essential: false }), false, `${category} must never move`);
  }
  assert.ok(NEVER_SHIFT.has("salary"));
  assert.equal(isShiftable({ category: "materials", essential: false }), true);
  assert.equal(isShiftable({ category: "materials", essential: true }), false, "the owner can still pin it");
});

test("moving a supplier payment lifts the trough above zero", () => {
  const scheduled = [
    { id: "wages", label: "Salaries", category: "salary", amount: 300000, due_date: d(5), essential: true },
    { id: "steel", label: "Sri Steel", category: "materials", amount: 250000, due_date: d(8), essential: false }
  ];
  const plan = optimize({
    openingBalance: 400000,
    invoices: [{ id: "i", customer: "A", number: "1", due_date: d(25), amount: 500000, paid_amount: 0 }],
    scheduled, recurring: [], asOf: TODAY, collectionDelay: 5, target: 0
  });

  assert.ok(plan.needed, "it was short to begin with");
  assert.ok(plan.before.minBalance < 0);
  assert.equal(plan.moves.length, 1);
  assert.equal(plan.moves[0].id, "steel", "the supplier moved");
  assert.ok(plan.after.minBalance > plan.before.minBalance);
  assert.ok(plan.blocked.some((b) => b.id === "wages"), "and the wages were named as untouchable");
});

test("when nothing shiftable exists, it says so instead of moving wages", () => {
  const plan = optimize({
    openingBalance: 10000,
    invoices: [],
    scheduled: [{ id: "wages", label: "Salaries", category: "salary", amount: 300000, due_date: d(5), essential: true }],
    recurring: [], asOf: TODAY, collectionDelay: 7, target: 0
  });
  assert.equal(plan.moves.length, 0);
  assert.equal(plan.solved, false);
  assert.ok(plan.blocked.length === 1);
});

// ------------------------------------------------------------------- csv ---

test("quoted commas inside a CSV field do not split the row", () => {
  const rows = parseCsv('a,b\n"one, two",three\n');
  assert.deepEqual(rows[1], ["one, two", "three"]);
});

test("a bank-style file with debit and credit columns imports", () => {
  const csv = [
    "Date,Particulars,Debit,Credit",
    "01-06-2026,Sri Steel Traders,150000,",
    "03-06-2026,Vibgyor Engineering,,420000"
  ].join("\n");
  const out = importTransactions(csv);
  assert.equal(out.bad.length, 0);
  assert.equal(out.ok[0].direction, "out");
  assert.equal(out.ok[0].amount, 150000);
  assert.equal(out.ok[1].direction, "in");
  assert.equal(out.ok[1].amount, 420000);
});

test("a row that cannot be read is rejected with its line number, never guessed", () => {
  const csv = ["Date,Amount,Type", "01-06-2026,5000,out", "notadate,5000,out", "02-06-2026,,out", "03-06-2026,5000,"].join("\n");
  const out = importTransactions(csv);
  assert.equal(out.ok.length, 2, "the good rows and the sign-inferred one still land");
  assert.equal(out.bad.length, 2);
  assert.equal(out.bad[0].line, 3);
  assert.match(out.bad[0].why, /date/i);
  assert.match(out.bad[1].why, /amount/i);
});

test("a negative amount means money out when no type column is given", () => {
  const out = importTransactions(["Date,Amount", "01-06-2026,-5000", "02-06-2026,9000"].join("\n"));
  assert.equal(out.ok[0].direction, "out");
  assert.equal(out.ok[1].direction, "in");
});

test("invoices without a due date borrow the credit terms", () => {
  const csv = ["Invoice No,Customer,Invoice Date,Amount,Credit Days", "INV-1,Anand Auto,01-06-2026,100000,30"].join("\n");
  const out = importInvoices(csv);
  assert.equal(out.bad.length, 0);
  assert.equal(out.ok[0].due_date, "2026-07-01");
});

test("an invoice with no due date and no terms is rejected rather than invented", () => {
  const out = importInvoices(["Invoice No,Customer,Amount", "INV-1,Anand Auto,100000"].join("\n"));
  assert.equal(out.ok.length, 0);
  assert.equal(out.bad.length, 1);
});

// ------------------------------------------------- double counting guards ---

import { withoutDoubleCounting } from "../src/analysis.js";

test("a cost that is both scheduled and recurring is counted once, not twice", () => {
  const recurring = [
    { key: "out|staff salaries", direction: "out", label: "Staff salaries", amount: 385000, everyDays: 30, nextDate: d(2) },
    { key: "out|tneb", direction: "out", label: "TNEB", amount: 64000, everyDays: 30, nextDate: d(9) },
    { key: "out|courier", direction: "out", label: "Courier", amount: 4000, everyDays: 30, nextDate: d(6) }
  ];
  const scheduled = [
    { id: "1", label: "Staff salaries", amount: 385000, due_date: d(2), paid: 0 },
    { id: "2", label: "TNEB electricity", amount: 64000, due_date: d(9), paid: 0 }
  ];

  const kept = withoutDoubleCounting(recurring, { scheduled, invoices: [] });
  assert.deepEqual(kept.map((r) => r.label), ["Courier"],
    "the two already scheduled drop out; the one nobody scheduled stays");
});

test("recurring money in is dropped when invoices already account for it", () => {
  const recurring = [{ key: "in|vibgyor", direction: "in", label: "Vibgyor Engineering", amount: 420000, everyDays: 30, nextDate: d(14) }];
  const invoices = [{ id: "i", customer: "Vibgyor Engineering", number: "1", due_date: d(12), amount: 510000, paid_amount: 0 }];

  assert.equal(withoutDoubleCounting(recurring, { scheduled: [], invoices }).length, 0,
    "the invoice is that money; counting the pattern too would collect it twice");

  assert.equal(withoutDoubleCounting(recurring, { scheduled: [], invoices: [] }).length, 1,
    "with no invoices on file, the historical pattern is the only thing we have");
});
