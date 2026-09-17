/**
 * One function that turns the stored records into every number the dashboard
 * shows — and, just as importantly, into the compact fact sheet the language
 * model is allowed to see.
 *
 * Both come from here so they cannot disagree. A chat that quotes a different
 * figure from the one on screen destroys trust in the whole tool in a single
 * sentence.
 */

import { today as todayISO, daysBetween } from "../../shared/money.js";
import { forecastAll, detectRecurring, typicalCollectionDelay } from "../../shared/forecast.js";
import { assessRisk } from "../../shared/risk.js";
import { ageInvoices } from "../../shared/invoices.js";
import { optimize } from "../../shared/optimizer.js";
import { loadAll } from "./db.js";

/** Average monthly outflow over the last 90 days of real transactions. */
function monthlyOutflow(transactions, asOf) {
  const recent = transactions.filter((t) => t.direction === "out" && daysBetween(t.date, asOf) <= 90 && daysBetween(t.date, asOf) >= 0);
  if (!recent.length) { return 0; }
  const total = recent.reduce((s, t) => s + t.amount, 0);
  const span = Math.max(30, daysBetween(recent[0].date, asOf));
  return Math.round((total / span) * 30);
}

/**
 * Stop the same money being counted twice.
 *
 * The forecast draws on three sources, and two of them can describe the same
 * event. Left alone, a business that keeps good records gets punished for it
 * with a forecast roughly twice as dramatic as reality:
 *
 *   - A monthly cost that is BOTH scheduled and visible in history would be
 *     counted once as a scheduled payment and again as a recurring outflow.
 *     The scheduled row wins: it is the specific, dated fact, while the
 *     recurring one is a pattern inferred from the past.
 *
 *   - Recurring money IN is the customer paying their invoices. If there are
 *     unsettled invoices, those invoices already account for that money, so
 *     the recurring inflow is the same rupees arriving a second time. Invoices
 *     win, because they carry real due dates and real amounts.
 *
 * Without this the demo business showed a ₹4L trough that did not exist, and a
 * payment plan that could not fix an imaginary problem.
 */
export function withoutDoubleCounting(recurring, { scheduled, invoices }) {
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const scheduledLabels = scheduled.filter((p) => !p.paid).map((p) => norm(p.label)).filter(Boolean);
  const hasOpenInvoices = invoices.some((i) => i.amount - (i.paid_amount ?? 0) > 0);

  return recurring.filter((r) => {
    if (r.direction === "in" && hasOpenInvoices) { return false; }
    const label = norm(r.label);
    if (!label) { return true; }
    return !scheduledLabels.some((s) => s.includes(label) || label.includes(s));
  });
}

export function analyse(db, { asOf = todayISO() } = {}) {
  const { openingBalance, transactions, invoices, scheduled } = loadAll(db);

  // The balance today: the opening figure plus everything that has happened.
  const settled = transactions.filter((t) => daysBetween(t.date, asOf) >= 0);
  const balanceToday = settled.reduce(
    (sum, t) => sum + (t.direction === "in" ? t.amount : -t.amount),
    openingBalance
  );

  const collectionDelay = typicalCollectionDelay(invoices);
  const recurring = withoutDoubleCounting(detectRecurring(transactions, asOf), { scheduled, invoices });

  const forecasts = forecastAll({
    openingBalance: balanceToday,
    invoices, scheduled, recurring, asOf, collectionDelay
  });

  const ageing = ageInvoices(invoices, asOf);
  const outflow30 = monthlyOutflow(transactions, asOf);
  const risk = assessRisk({ forecasts, invoices, asOf, monthlyOutflow: outflow30 });

  const plan = optimize({
    openingBalance: balanceToday,
    invoices, scheduled, recurring, asOf, collectionDelay, target: 0
  });

  return {
    asOf,
    balanceToday,
    openingBalance,
    monthlyOutflow: outflow30,
    collectionDelay,
    counts: { transactions: transactions.length, invoices: invoices.length, scheduled: scheduled.length },
    recurring,
    forecasts,
    ageing,
    risk,
    plan
  };
}

/**
 * The fact sheet handed to the language model.
 *
 * Small on purpose: a few dozen numbers, already computed, already rounded.
 * The model's job is to say them in plain words, so it is given the answers
 * rather than the raw ledger it would have to do arithmetic over. Language
 * models are unreliable at arithmetic and completely reliable at rephrasing,
 * so the division of labour follows the machine's actual strengths.
 */
export function factSheet(analysis) {
  const f = analysis.forecasts;
  return {
    as_of: analysis.asOf,
    cash_today: analysis.balanceToday,
    monthly_outflow: analysis.monthlyOutflow,
    typical_collection_delay_days: analysis.collectionDelay,
    risk: {
      level: analysis.risk.level,
      headline: analysis.risk.headline,
      lowest_balance: analysis.risk.minBalance,
      lowest_on: analysis.risk.minDate,
      days_until_negative: analysis.risk.daysUntilNegative,
      days_of_costs_in_hand_at_lowest: analysis.risk.bufferDays,
      reasons: analysis.risk.reasons.map((r) => ({ title: r.title, detail: r.detail }))
    },
    forecast_90_days: {
      expected: { closing: f.expected.closing, lowest: f.expected.minBalance, lowest_on: f.expected.minDate, money_in: f.expected.totalIn, money_out: f.expected.totalOut },
      optimistic: { closing: f.optimistic.closing, lowest: f.optimistic.minBalance },
      pessimistic: { closing: f.pessimistic.closing, lowest: f.pessimistic.minBalance, goes_negative_on: f.pessimistic.firstNegativeDate }
    },
    invoices: {
      total_outstanding: analysis.ageing.total,
      overdue_count: analysis.ageing.overdueCount,
      overdue_total: analysis.ageing.overdueTotal,
      buckets: analysis.ageing.buckets.map((b) => ({ label: b.label, count: b.count, total: b.total })),
      worst_five: analysis.ageing.rows.slice(0, 5).map((r) => ({
        customer: r.customer, invoice: r.number, outstanding: r.outstanding, days_overdue: r.daysOverdue
      }))
    },
    recurring_monthly: analysis.recurring.slice(0, 8).map((r) => ({
      label: r.label, direction: r.direction, amount: r.amount, next_on: r.nextDate
    })),
    suggested_payment_moves: analysis.plan.moves.map((m) => ({
      payment: m.label, amount: m.amount, from: m.from, to: m.to
    })),
    payments_that_cannot_be_moved: analysis.plan.blocked.map((b) => ({
      payment: b.label, amount: b.amount, due: b.due_date, why: b.why
    }))
  };
}
