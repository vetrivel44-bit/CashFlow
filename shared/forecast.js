/**
 * The forecast.
 *
 * Ninety days of daily closing balance, under three scenarios. Everything here
 * is deterministic arithmetic over the data the owner gave us — there is no
 * model in this file, and there never should be. The language model in this
 * app explains these numbers; it does not produce them.
 *
 * The forecast is built from three sources, and each one is visible in the
 * output so any figure on screen can be traced back to a row:
 *
 *   1. Invoices the business has raised     → money expected in
 *   2. Scheduled payments already known     → money certain to go out
 *   3. Recurring items found in history     → money that goes in and out
 *      every month whether or not anyone scheduled it
 *
 * The third is the one that makes a forecast honest. A business that forgets
 * its ₹2,00,000 of monthly standing costs will forecast a healthy month and
 * then wonder where the cash went.
 */

import { addDays, daysBetween, median, today as todayISO } from "./money.js";

export const HORIZON_DAYS = 90;

/**
 * How each scenario bends reality.
 *
 * `collectionShift` moves expected collection dates; `collectionRate` is the
 * share of invoice value that lands inside the horizon at all; `outflowFactor`
 * stretches costs. The pessimistic case is not a doomsday — it is a normal bad
 * quarter: customers pay three weeks later than usual, a fifth of what is owed
 * does not arrive this quarter, and costs run ten percent over.
 */
export const SCENARIOS = {
  expected:    { collectionShift: 0,   collectionRate: 1.0,  outflowFactor: 1.0 },
  optimistic:  { collectionShift: -7,  collectionRate: 1.0,  outflowFactor: 0.97 },
  pessimistic: { collectionShift: 21,  collectionRate: 0.8,  outflowFactor: 1.1 }
};

/**
 * Find things that happen every month.
 *
 * Grouped by counterparty and direction. Three or more occurrences with a
 * typical gap of 25–35 days is treated as monthly. Anything less regular is
 * left out rather than guessed at: a forecast that invents an outflow is worse
 * than one that misses it, because the owner stops believing the tool.
 */
export function detectRecurring(transactions, asOf = todayISO()) {
  const groups = new Map();
  for (const t of transactions) {
    const key = `${t.direction}|${(t.counterparty || t.category || "other").toLowerCase().trim()}`;
    if (!groups.has(key)) { groups.set(key, []); }
    groups.get(key).push(t);
  }

  const found = [];
  for (const [key, rows] of groups) {
    if (rows.length < 3) { continue; }
    const sorted = rows.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) { gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date)); }
    const gap = median(gaps);
    if (gap < 25 || gap > 35) { continue; }

    const last = sorted[sorted.length - 1];
    const amount = median(sorted.map((r) => r.amount));
    if (amount <= 0) { continue; }

    // Roll forward to the first occurrence that is still ahead of us.
    let next = addDays(last.date, gap);
    while (daysBetween(asOf, next) < 0) { next = addDays(next, gap); }

    const [direction] = key.split("|");
    found.push({
      key,
      direction,
      label: last.counterparty || last.category || "Recurring",
      category: last.category || "",
      amount,
      everyDays: gap,
      nextDate: next,
      seenTimes: sorted.length
    });
  }
  return found.sort((a, b) => b.amount - a.amount);
}

/** How late this business's customers actually pay, from the invoices already settled. */
export function typicalCollectionDelay(invoices) {
  const settled = invoices.filter((i) => i.paid_date && i.due_date);
  if (settled.length < 3) { return 7; }   // no history yet: assume a week late
  return Math.max(0, median(settled.map((i) => daysBetween(i.due_date, i.paid_date))));
}

/**
 * Build one scenario's daily balance line.
 *
 * Returns a day-by-day series plus the events that moved it, so the interface
 * can answer "why does it dip on the 14th" by naming the rows responsible.
 */
export function buildSeries({
  openingBalance,
  invoices = [],
  scheduled = [],
  recurring = [],
  scenario = "expected",
  asOf = todayISO(),
  horizon = HORIZON_DAYS,
  collectionDelay = 7
}) {
  const rules = SCENARIOS[scenario];
  if (!rules) { throw new Error(`Unknown scenario: ${scenario}`); }

  const events = new Map();   // iso date -> [{label, amount, direction, kind}]
  const put = (date, event) => {
    if (daysBetween(asOf, date) < 0 || daysBetween(asOf, date) > horizon) { return; }
    if (!events.has(date)) { events.set(date, []); }
    events.get(date).push(event);
  };

  // 1. Invoices still owed to us.
  for (const inv of invoices) {
    const outstanding = inv.amount - (inv.paid_amount ?? 0);
    if (outstanding <= 0) { continue; }

    // Already overdue invoices are expected on top of the usual delay, counted
    // from today rather than from a due date that has already passed.
    const overdueDays = Math.max(0, daysBetween(inv.due_date, asOf));
    const base = overdueDays > 0 ? asOf : inv.due_date;
    const expectedOn = addDays(base, Math.max(0, collectionDelay + rules.collectionShift));

    put(expectedOn, {
      kind: "invoice",
      id: inv.id,
      label: `${inv.customer} · ${inv.number}`,
      direction: "in",
      amount: Math.round(outstanding * rules.collectionRate)
    });
  }

  // 2. Payments already scheduled.
  for (const p of scheduled) {
    if (p.paid) { continue; }
    put(p.due_date, {
      kind: "scheduled",
      id: p.id,
      label: p.label,
      category: p.category,
      essential: Boolean(p.essential),
      direction: "out",
      amount: Math.round(p.amount * rules.outflowFactor)
    });
  }

  // 3. Whatever happens every month, repeated across the horizon.
  for (const r of recurring) {
    let date = r.nextDate;
    while (daysBetween(asOf, date) <= horizon) {
      put(date, {
        kind: "recurring",
        id: r.key,
        label: r.label,
        category: r.category,
        direction: r.direction,
        amount: Math.round(r.amount * (r.direction === "out" ? rules.outflowFactor : rules.collectionRate))
      });
      date = addDays(date, r.everyDays);
    }
  }

  const days = [];
  let balance = openingBalance;
  for (let i = 0; i <= horizon; i++) {
    const date = addDays(asOf, i);
    const onDay = events.get(date) ?? [];
    const inflow = onDay.filter((e) => e.direction === "in").reduce((s, e) => s + e.amount, 0);
    const outflow = onDay.filter((e) => e.direction === "out").reduce((s, e) => s + e.amount, 0);
    balance += inflow - outflow;
    days.push({ date, inflow, outflow, balance, events: onDay });
  }

  const trough = days.reduce((low, d) => (d.balance < low.balance ? d : low), days[0]);
  const firstNegative = days.find((d) => d.balance < 0) ?? null;

  return {
    scenario,
    days,
    closing: days[days.length - 1].balance,
    minBalance: trough.balance,
    minDate: trough.date,
    firstNegativeDate: firstNegative ? firstNegative.date : null,
    daysUntilNegative: firstNegative ? daysBetween(asOf, firstNegative.date) : null,
    totalIn: days.reduce((s, d) => s + d.inflow, 0),
    totalOut: days.reduce((s, d) => s + d.outflow, 0)
  };
}

/** All three scenarios over the same inputs. */
export function forecastAll(input) {
  const collectionDelay = input.collectionDelay ?? typicalCollectionDelay(input.invoices ?? []);
  const out = {};
  for (const name of Object.keys(SCENARIOS)) {
    out[name] = buildSeries({ ...input, collectionDelay, scenario: name });
  }
  out.collectionDelay = collectionDelay;
  return out;
}
