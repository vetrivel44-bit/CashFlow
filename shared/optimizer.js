/**
 * The payment optimizer.
 *
 * It suggests moving non-essential payments later so the balance stays above
 * zero. It suggests — it never reschedules anything itself, and it never
 * contacts anyone. The owner decides, because the cost of moving a payment is
 * a supplier relationship, and this program cannot see that.
 *
 * NEVER MOVED, under any circumstances:
 *
 *   salary   — people have rent and school fees of their own, and a business
 *              that delays wages to smooth its own curve has stopped being a
 *              cash flow problem and become a different kind of problem.
 *   tax      — statutory dates, with interest and penalties attached, and
 *              nothing this tool computes is worth a notice from the
 *              department.
 *   loan_emi — a missed EMI reaches the credit bureau and costs the business
 *              its next loan, long after the cash crunch is over.
 *
 * These are refused even when the owner marks them shiftable in the data. That
 * is the one place this tool overrules its user, and it is deliberate.
 */

import { addDays, daysBetween } from "./money.js";
import { buildSeries } from "./forecast.js";

export const NEVER_SHIFT = new Set(["salary", "wages", "payroll", "tax", "gst", "tds", "loan_emi", "emi", "loan", "interest"]);
export const MAX_SHIFT_DAYS = 30;

export function isShiftable(payment) {
  const category = String(payment.category ?? "").toLowerCase().trim();
  if (NEVER_SHIFT.has(category)) { return false; }
  if (payment.essential) { return false; }
  return true;
}

export function whyNotShiftable(payment) {
  const category = String(payment.category ?? "").toLowerCase().trim();
  if (NEVER_SHIFT.has(category)) {
    if (["salary", "wages", "payroll"].includes(category)) { return "Wages are never delayed by this tool."; }
    if (["tax", "gst", "tds"].includes(category)) { return "Statutory dates carry interest and penalties."; }
    return "A missed EMI reaches the credit bureau.";
  }
  if (payment.essential) { return "Marked essential."; }
  return null;
}

/**
 * Greedy, and deliberately so.
 *
 * Each round it tries the largest shiftable payment that falls before the
 * trough, moves it to the latest date that still helps, and re-runs the whole
 * forecast to see what actually happened. Re-running rather than estimating
 * matters: moving a payment past a second dip can make things worse, and only
 * a real recomputation catches that.
 *
 * It stops as soon as the balance clears the target, so the owner gets the
 * smallest set of changes that does the job rather than a rescheduled quarter.
 */
export function optimize({ openingBalance, invoices, scheduled, recurring, asOf, collectionDelay, target = 0, maxMoves = 6 }) {
  const base = () => buildSeries({
    openingBalance, invoices, scheduled: working, recurring,
    scenario: "expected", asOf, collectionDelay
  });

  let working = scheduled.map((p) => ({ ...p }));
  const before = base();
  const moves = [];

  if (before.minBalance >= target) {
    return { needed: false, before, after: before, moves, blocked: [] };
  }

  const blocked = scheduled
    .filter((p) => !p.paid && !isShiftable(p))
    .map((p) => ({ id: p.id, label: p.label, amount: p.amount, due_date: p.due_date, why: whyNotShiftable(p) }));

  for (let round = 0; round < maxMoves; round++) {
    const current = base();
    if (current.minBalance >= target) { break; }

    const candidates = working
      .filter((p) => !p.paid && isShiftable(p) && !moves.some((m) => m.id === p.id))
      .filter((p) => daysBetween(p.due_date, current.minDate) >= 0)   // only what happens before the trough
      .sort((a, b) => b.amount - a.amount);

    if (!candidates.length) { break; }

    let best = null;
    for (const candidate of candidates) {
      // Try landing just after the trough, then later, capped at MAX_SHIFT_DAYS.
      const wanted = daysBetween(candidate.due_date, current.minDate) + 1;
      for (const delay of [wanted, wanted + 7, MAX_SHIFT_DAYS]) {
        const shift = Math.min(MAX_SHIFT_DAYS, Math.max(1, delay));
        const newDate = addDays(candidate.due_date, shift);
        const saved = candidate.due_date;
        candidate.due_date = newDate;
        const trial = base();
        candidate.due_date = saved;

        if (!best || trial.minBalance > best.minBalance) {
          best = { candidate, shift, newDate, minBalance: trial.minBalance };
        }
      }
    }

    if (!best || best.minBalance <= current.minBalance) { break; }   // no move helps

    best.candidate.due_date = best.newDate;
    moves.push({
      id: best.candidate.id,
      label: best.candidate.label,
      category: best.candidate.category,
      amount: best.candidate.amount,
      from: scheduled.find((p) => p.id === best.candidate.id).due_date,
      to: best.newDate,
      shiftDays: best.shift,
      minBalanceAfter: best.minBalance
    });
  }

  const after = base();
  return {
    needed: true,
    solved: after.minBalance >= target,
    before,
    after,
    moves,
    blocked,
    gained: after.minBalance - before.minBalance
  };
}
