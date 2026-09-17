/**
 * Risk, and why.
 *
 * A colour on its own is not useful — an owner cannot act on "AMBER". Every
 * verdict here carries the reasons that produced it, each one naming a figure
 * and where it came from, so the next question ("what do I do about it?") has
 * somewhere to start.
 *
 * The thresholds are stated as constants rather than buried in conditionals,
 * because they are a judgement call and the owner deserves to be able to
 * disagree with them.
 */

import { daysBetween } from "./money.js";
import { ageInvoices } from "./invoices.js";

export const RED_WITHIN_DAYS = 30;     // expected case goes negative this soon → red
export const AMBER_BUFFER_DAYS = 21;   // less than three weeks of costs in hand → amber

export function assessRisk({ forecasts, invoices = [], asOf, monthlyOutflow = 0 }) {
  const expected = forecasts.expected;
  const pessimistic = forecasts.pessimistic;
  const dailyBurn = Math.max(1, Math.round(monthlyOutflow / 30));
  const bufferDays = Math.round(expected.minBalance / dailyBurn);

  let level = "GREEN";
  let headline = "";

  if (expected.firstNegativeDate && expected.daysUntilNegative <= RED_WITHIN_DAYS) {
    level = "RED";
    headline = expected.daysUntilNegative <= 0
      ? "You are short of cash now."
      : `You run out of cash in ${expected.daysUntilNegative} days.`;
  } else if (expected.firstNegativeDate) {
    level = "AMBER";
    headline = `You run out of cash in ${expected.daysUntilNegative} days, on the expected case.`;
  } else if (pessimistic.firstNegativeDate) {
    level = "AMBER";
    headline = `You stay positive if collections hold, but go negative in ${pessimistic.daysUntilNegative} days if they slip.`;
  } else if (bufferDays < AMBER_BUFFER_DAYS) {
    level = "AMBER";
    headline = `Your lowest point leaves about ${bufferDays} days of costs in hand.`;
  } else {
    headline = `You stay positive for the next 90 days, with a low point of ${Math.round(expected.minBalance / dailyBurn)} days of costs in hand.`;
  }

  return {
    level,
    headline,
    asOf,
    minBalance: expected.minBalance,
    minDate: expected.minDate,
    daysUntilNegative: expected.daysUntilNegative,
    bufferDays,
    reasons: buildReasons({ expected, pessimistic, invoices, asOf })
  };
}

/**
 * The reasons, biggest first.
 *
 * Each is something the owner could act on this week. Vague observations are
 * deliberately left out — "revenue is seasonal" is true of everyone and helps
 * nobody.
 */
function buildReasons({ expected, pessimistic, invoices, asOf }) {
  const reasons = [];
  const ageing = ageInvoices(invoices, asOf);

  if (ageing.overdueTotal > 0) {
    const worst = ageing.rows
      .filter((r) => r.daysOverdue > 0)
      .sort((a, b) => b.outstanding - a.outstanding)[0];
    reasons.push({
      code: "overdue_invoices",
      weight: ageing.overdueTotal,
      title: `${ageing.overdueCount} overdue ${ageing.overdueCount === 1 ? "invoice" : "invoices"} worth ₹${ageing.overdueTotal.toLocaleString("en-IN")}`,
      detail: worst
        ? `The largest is ${worst.customer} — ₹${worst.outstanding.toLocaleString("en-IN")}, ${worst.daysOverdue} days past due.`
        : "",
      action: "chase_invoices"
    });
  }

  // The single largest outflow between now and the trough is usually the one
  // worth moving, so name it rather than making the owner hunt for it.
  const troughIndex = expected.days.findIndex((d) => d.date === expected.minDate);
  const upToTrough = expected.days.slice(0, Math.max(1, troughIndex + 1));
  const outEvents = upToTrough.flatMap((d) => d.events.filter((e) => e.direction === "out").map((e) => ({ ...e, date: d.date })));
  const biggest = outEvents.sort((a, b) => b.amount - a.amount)[0];
  if (biggest && biggest.amount > 0) {
    reasons.push({
      code: "large_outflow",
      weight: biggest.amount,
      title: `A ₹${biggest.amount.toLocaleString("en-IN")} payment on ${biggest.date}`,
      detail: `${biggest.label}${biggest.essential ? " — essential, so it cannot be moved." : ""}`,
      action: biggest.essential ? null : "shift_payment"
    });
  }

  if (expected.totalOut > expected.totalIn) {
    reasons.push({
      code: "outflow_exceeds_inflow",
      weight: expected.totalOut - expected.totalIn,
      title: `₹${(expected.totalOut - expected.totalIn).toLocaleString("en-IN")} more going out than coming in over 90 days`,
      detail: "Money in does not cover money out over the horizon. Closing a gap this size needs new sales or lower costs, not rescheduling.",
      action: null
    });
  }

  if (!expected.firstNegativeDate && pessimistic.firstNegativeDate) {
    reasons.push({
      code: "fragile_to_delay",
      weight: Math.abs(pessimistic.minBalance),
      title: "The plan depends on customers paying roughly on time",
      detail: `If collections slip by three weeks and a fifth of what is owed does not arrive, you go negative on ${pessimistic.firstNegativeDate}.`,
      action: "chase_invoices"
    });
  }

  return reasons.sort((a, b) => b.weight - a.weight);
}
