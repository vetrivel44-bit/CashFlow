/**
 * Invoice ageing.
 *
 * The buckets are the ones the brief asks for: 0–15, 15–30, and 30+ days past
 * due, with anything not yet due kept separate. "Not due yet" is deliberately
 * its own bucket rather than being folded into 0–15 — an invoice that is not
 * late is not a collection problem, and mixing the two makes the overdue total
 * look worse than it is, which is exactly the number an owner needs to trust.
 */

import { daysBetween, today as todayISO } from "./money.js";

export const BUCKETS = [
  { id: "not_due", label: "Not due yet", from: null, to: 0 },
  { id: "d0_15", label: "1–15 days", from: 1, to: 15 },
  { id: "d15_30", label: "16–30 days", from: 16, to: 30 },
  { id: "d30_plus", label: "Over 30 days", from: 31, to: null }
];

export function bucketFor(daysOverdue) {
  if (daysOverdue <= 0) { return "not_due"; }
  if (daysOverdue <= 15) { return "d0_15"; }
  if (daysOverdue <= 30) { return "d15_30"; }
  return "d30_plus";
}

export function ageInvoices(invoices, asOf = todayISO()) {
  const rows = invoices
    .map((inv) => {
      const outstanding = inv.amount - (inv.paid_amount ?? 0);
      const daysOverdue = daysBetween(inv.due_date, asOf);
      return {
        id: inv.id,
        number: inv.number,
        customer: inv.customer,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        amount: inv.amount,
        paid_amount: inv.paid_amount ?? 0,
        outstanding,
        settled: outstanding <= 0,
        daysOverdue: Math.max(0, daysOverdue),
        bucket: bucketFor(daysOverdue)
      };
    })
    .filter((r) => !r.settled)
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding);

  const buckets = BUCKETS.map((b) => {
    const inBucket = rows.filter((r) => r.bucket === b.id);
    return {
      ...b,
      count: inBucket.length,
      total: inBucket.reduce((s, r) => s + r.outstanding, 0)
    };
  });

  const overdue = rows.filter((r) => r.daysOverdue > 0);

  return {
    asOf,
    rows,
    buckets,
    total: rows.reduce((s, r) => s + r.outstanding, 0),
    overdueCount: overdue.length,
    overdueTotal: overdue.reduce((s, r) => s + r.outstanding, 0)
  };
}

/**
 * A reminder, drafted — never sent.
 *
 * The app writes the words and stops. Sending is the owner's, from their own
 * account, after reading it: an automatic reminder eventually goes to the
 * customer who paid yesterday in cash, and that costs more than the invoice.
 *
 * The tone shifts with age, because a five-day nudge and a sixty-day chase are
 * not the same conversation, but it never threatens. These are customers the
 * business wants to keep.
 */
export function draftReminder(row, { business = "our office", polite = true } = {}) {
  const amount = "₹" + row.outstanding.toLocaleString("en-IN");
  const ref = `${row.number} dated ${row.due_date}`;

  if (row.daysOverdue <= 0) {
    return `Dear ${row.customer},\n\nThis is a gentle note that invoice ${ref} for ${amount} falls due shortly. No action is needed if payment is already arranged.\n\nThank you for your business.\n${business}`;
  }
  if (row.daysOverdue <= 15) {
    return `Dear ${row.customer},\n\nInvoice ${ref} for ${amount} became due ${row.daysOverdue} days ago and is still showing as outstanding at our end. If it has already been paid, please share the payment details so we can update our records.\n\nThank you,\n${business}`;
  }
  if (row.daysOverdue <= 30) {
    return `Dear ${row.customer},\n\nWe are following up on invoice ${ref} for ${amount}, now ${row.daysOverdue} days past due. Could you confirm when we may expect payment? If there is an issue with the invoice, please tell us and we will sort it out.\n\nThank you,\n${business}`;
  }
  return `Dear ${row.customer},\n\nInvoice ${ref} for ${amount} is now ${row.daysOverdue} days past due. We would like to settle this and would appreciate a date for payment, or a part payment if that is easier at the moment.\n\nPlease let us know if you would prefer to discuss it over a call.\n\nThank you,\n${business}`;
}
