/**
 * The explainer.
 *
 * Two ways to answer a question, in this order:
 *
 *   1. A local model, if one is running. Ollama on 127.0.0.1:11434 is the
 *      default, because it is what "local AI" means in practice on a laptop.
 *      Nothing leaves the machine.
 *   2. A written answer, composed from the same facts, if no model is there.
 *
 * The second is not a degraded mode to apologise for. Every question this app
 * expects has a correct answer already computed, and a sentence assembled from
 * those numbers is more reliable than one generated from them. The model makes
 * the reply read better; it is not what makes it true.
 *
 * The model NEVER sees the ledger and is NEVER asked to calculate. It gets the
 * fact sheet — a few dozen numbers, already worked out — and is told to answer
 * only from it. Language models are unreliable at arithmetic and reliable at
 * rephrasing, so they are given only the second job.
 */

import { rupees } from "../../shared/money.js";

const SYSTEM_PROMPT = `You explain a small business's cash position to its owner.

RULES, without exception:
- Answer ONLY from the FACTS given. They are already correct.
- Never calculate, estimate, or invent a number. If a figure is not in the FACTS, say you do not have it.
- Amounts are Indian rupees. Write them as ₹1,20,000 (Indian digit grouping).
- Be short: two to four sentences. This is a busy owner, not a report.
- Plain words. No jargon, no "leverage", no "runway" unless you explain it.
- If the news is bad, say so directly in the first sentence, then what is driving it.
- Never give legal, tax or investment advice.`;

export function buildPrompt(question, facts) {
  return `FACTS (already computed, treat as true):\n${JSON.stringify(facts, null, 1)}\n\nQUESTION: ${question}`;
}

/**
 * Ask a local model. Returns null rather than throwing when none is running —
 * a missing model is the normal case on a fresh machine, not an error worth
 * showing the owner.
 */
export async function askLocalModel(question, facts, { url, model, timeoutMs = 45000 } = {}) {
  const endpoint = (url ?? process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const name = model ?? process.env.OLLAMA_MODEL ?? "llama3.2";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: name,
        stream: false,
        options: { temperature: 0.2 },   // explaining, not composing
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(question, facts) }
        ]
      })
    });
    if (!res.ok) { return null; }
    const body = await res.json();
    const text = body?.message?.content?.trim();
    return text ? { text, source: `local model (${name})` } : null;
  } catch {
    return null;   // not running, wrong port, no such model — all the same to us
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The written answer.
 *
 * Matches the question against the handful of things an owner actually asks,
 * and assembles a reply from the facts. Everything it says is a number that is
 * already on screen somewhere.
 */
export function answerFromFacts(question, facts) {
  const q = String(question ?? "").toLowerCase();
  const has = (...words) => words.some((w) => q.includes(w));
  const r = facts.risk;
  const inv = facts.invoices;

  if (has("overdue", "who owes", "chase", "follow up", "collect")) {
    if (!inv.overdue_count) {
      return { text: `Nothing is overdue. ${rupees(inv.total_outstanding)} is outstanding across your invoices, all of it still within terms.`, source: "computed" };
    }
    const worst = inv.worst_five[0];
    return {
      text: `${inv.overdue_count} ${inv.overdue_count === 1 ? "invoice is" : "invoices are"} overdue, worth ${rupees(inv.overdue_total)} of the ${rupees(inv.total_outstanding)} outstanding. The worst is ${worst.customer} (${worst.invoice}) at ${rupees(worst.outstanding)}, ${worst.days_overdue} days past due. Your customers typically pay ${facts.typical_collection_delay_days} days after the due date, so anything well beyond that needs a call rather than another email.`,
      source: "computed"
    };
  }

  if (has("move", "shift", "delay", "postpone", "reschedul", "optimi")) {
    if (!facts.suggested_payment_moves.length) {
      return { text: `Nothing needs moving. Your lowest point over the next 90 days is ${rupees(r.lowest_balance)} on ${r.lowest_on}, which stays above zero.`, source: "computed" };
    }
    const lines = facts.suggested_payment_moves
      .map((m) => `${m.payment} (${rupees(m.amount)}) from ${m.from} to ${m.to}`)
      .join("; ");
    const blocked = facts.payments_that_cannot_be_moved.length
      ? ` Wages, tax and EMI are never moved, so ${facts.payments_that_cannot_be_moved.length} payment${facts.payments_that_cannot_be_moved.length === 1 ? "" : "s"} stayed where they are.`
      : "";
    return { text: `Moving ${lines} keeps you above zero.${blocked} These are suggestions — nothing has been rescheduled.`, source: "computed" };
  }

  if (has("why", "risk", "worried", "problem", "wrong")) {
    const reasons = r.reasons.slice(0, 2).map((x) => x.title).join(", and ");
    return {
      text: `${r.headline} Your lowest point is ${rupees(r.lowest_balance)} on ${r.lowest_on}. ${reasons ? `The main drivers are ${reasons}.` : ""}`,
      source: "computed"
    };
  }

  if (has("forecast", "next month", "90", "future", "predict", "outlook")) {
    const f = facts.forecast_90_days;
    return {
      text: `Over 90 days you expect ${rupees(f.expected.money_in)} in and ${rupees(f.expected.money_out)} out, closing at ${rupees(f.expected.closing)}. The low point is ${rupees(f.expected.lowest)} on ${f.expected.lowest_on}. If collections slip, that low point becomes ${rupees(f.pessimistic.lowest)}${f.pessimistic.goes_negative_on ? `, going negative on ${f.pessimistic.goes_negative_on}` : ""}.`,
      source: "computed"
    };
  }

  if (has("cash", "balance", "how much", "today", "have")) {
    return {
      text: `You have ${rupees(facts.cash_today)} today. You spend about ${rupees(facts.monthly_outflow)} a month, and ${rupees(inv.total_outstanding)} is owed to you by customers.`,
      source: "computed"
    };
  }

  return {
    text: `${r.headline} You have ${rupees(facts.cash_today)} today, with a low point of ${rupees(r.lowest_balance)} on ${r.lowest_on}. Ask me about overdue invoices, the 90-day forecast, or which payments could move.`,
    source: "computed"
  };
}

export async function answer(question, facts, options = {}) {
  if (options.useLocalModel !== false) {
    const fromModel = await askLocalModel(question, facts, options);
    if (fromModel) { return fromModel; }
  }
  return answerFromFacts(question, facts);
}
