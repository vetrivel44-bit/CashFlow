/**
 * CSV import.
 *
 * Real exports from Tally, a bank statement or a spreadsheet do not agree on
 * column names, date formats, or how they signal money going out. So the
 * importer guesses the mapping, reports what it guessed, and refuses rows it
 * cannot read rather than inventing values for them.
 *
 * Two rules throughout:
 *
 *   - A row that cannot be read with confidence is REJECTED with a reason,
 *     never coerced. A silently misread amount is worse than a missing row,
 *     because the total still looks plausible.
 *   - Nothing is dropped quietly. Every rejected row comes back with its line
 *     number and what was wrong with it.
 */

import { parseDate, toRupees } from "../../shared/money.js";

/** A CSV parser that handles quoted fields, embedded commas and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; }
      } else { field += c; }
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Find the column whose header matches any of these names. */
function findColumn(headers, candidates) {
  const normalised = headers.map(norm);
  for (const want of candidates) {
    const i = normalised.indexOf(norm(want));
    if (i !== -1) { return i; }
  }
  for (const want of candidates) {
    const i = normalised.findIndex((h) => h.includes(norm(want)));
    if (i !== -1) { return i; }
  }
  return -1;
}

const OUT_WORDS = new Set(["out", "debit", "dr", "paid", "payment", "expense", "withdrawal", "purchase", "spent"]);
const IN_WORDS = new Set(["in", "credit", "cr", "received", "receipt", "income", "deposit", "sale", "sales"]);

export function importTransactions(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) { return { ok: [], bad: [{ line: 1, why: "The file has no rows under its header." }], mapping: {} }; }

  const headers = rows[0];
  const col = {
    date: findColumn(headers, ["date", "txn date", "transaction date", "value date"]),
    amount: findColumn(headers, ["amount", "value", "rupees", "inr"]),
    direction: findColumn(headers, ["direction", "type", "dr/cr", "drcr", "in/out"]),
    debit: findColumn(headers, ["debit", "withdrawal", "paid out"]),
    credit: findColumn(headers, ["credit", "deposit", "paid in"]),
    category: findColumn(headers, ["category", "head", "account", "ledger"]),
    counterparty: findColumn(headers, ["counterparty", "party", "customer", "vendor", "supplier", "name", "narration", "description", "particulars"]),
    note: findColumn(headers, ["note", "remarks", "comment"])
  };

  if (col.date === -1) {
    return { ok: [], bad: [{ line: 1, why: "No date column found. Name one of the columns 'Date'." }], mapping: col };
  }
  if (col.amount === -1 && col.debit === -1 && col.credit === -1) {
    return { ok: [], bad: [{ line: 1, why: "No amount column found. Name one 'Amount', or use separate 'Debit' and 'Credit' columns." }], mapping: col };
  }

  const ok = [];
  const bad = [];

  for (let r = 1; r < rows.length; r++) {
    const line = r + 1;
    const cells = rows[r];
    const at = (i) => (i === -1 ? "" : String(cells[i] ?? "").trim());

    const date = parseDate(at(col.date));
    if (!date) {
      bad.push({ line, why: `Could not read the date "${at(col.date)}". Use DD-MM-YYYY or YYYY-MM-DD.` });
      continue;
    }

    let amount = null;
    let direction = null;

    // Separate debit/credit columns, the way a bank statement comes.
    if (col.debit !== -1 || col.credit !== -1) {
      const debit = toRupees(at(col.debit));
      const credit = toRupees(at(col.credit));
      if (debit && debit !== 0) { amount = Math.abs(debit); direction = "out"; }
      else if (credit && credit !== 0) { amount = Math.abs(credit); direction = "in"; }
    }

    // A single amount column, with direction from a type column or the sign.
    if (amount === null && col.amount !== -1) {
      const raw = toRupees(at(col.amount));
      if (raw === null) {
        bad.push({ line, why: `Could not read the amount "${at(col.amount)}".` });
        continue;
      }
      amount = Math.abs(raw);
      const typeWord = norm(at(col.direction));
      if (OUT_WORDS.has(typeWord)) { direction = "out"; }
      else if (IN_WORDS.has(typeWord)) { direction = "in"; }
      else if (raw < 0) { direction = "out"; }
      else if (raw > 0) { direction = "in"; }
    }

    if (amount === null || amount === 0) {
      bad.push({ line, why: "The amount was empty or zero." });
      continue;
    }
    if (!direction) {
      bad.push({ line, why: "Could not tell whether this was money in or money out. Add a 'Type' column with in/out, or use a negative amount for money out." });
      continue;
    }

    ok.push({
      date,
      direction,
      amount,
      category: at(col.category),
      counterparty: at(col.counterparty),
      note: at(col.note)
    });
  }

  return { ok, bad, mapping: describeMapping(headers, col) };
}

export function importInvoices(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) { return { ok: [], bad: [{ line: 1, why: "The file has no rows under its header." }], mapping: {} }; }

  const headers = rows[0];
  const col = {
    number: findColumn(headers, ["invoice", "invoice no", "invoice number", "bill no", "number", "ref"]),
    customer: findColumn(headers, ["customer", "party", "client", "name", "buyer"]),
    issue_date: findColumn(headers, ["issue date", "invoice date", "date"]),
    due_date: findColumn(headers, ["due date", "due", "payment due"]),
    amount: findColumn(headers, ["amount", "total", "invoice amount", "value"]),
    paid_amount: findColumn(headers, ["paid", "paid amount", "received", "amount received"]),
    paid_date: findColumn(headers, ["paid date", "payment date", "settled on"]),
    terms: findColumn(headers, ["terms", "credit days", "payment terms"])
  };

  if (col.customer === -1 || col.amount === -1) {
    return { ok: [], bad: [{ line: 1, why: "An invoice file needs at least a customer column and an amount column." }], mapping: col };
  }

  const ok = [];
  const bad = [];

  for (let r = 1; r < rows.length; r++) {
    const line = r + 1;
    const cells = rows[r];
    const at = (i) => (i === -1 ? "" : String(cells[i] ?? "").trim());

    const amount = toRupees(at(col.amount));
    if (!amount || amount <= 0) {
      bad.push({ line, why: `Could not read the invoice amount "${at(col.amount)}".` });
      continue;
    }

    const customer = at(col.customer);
    if (!customer) { bad.push({ line, why: "The customer name was empty." }); continue; }

    const issue = parseDate(at(col.issue_date));
    let due = parseDate(at(col.due_date));

    // No due date, but credit terms given: derive it rather than reject.
    if (!due && issue && col.terms !== -1) {
      const days = Number(String(at(col.terms)).replace(/\D/g, ""));
      if (Number.isFinite(days) && days > 0) {
        const d = new Date(issue + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + days);
        due = d.toISOString().slice(0, 10);
      }
    }
    if (!due) {
      bad.push({ line, why: "No due date, and no credit terms to work one out from." });
      continue;
    }

    const paid = toRupees(at(col.paid_amount)) ?? 0;
    ok.push({
      number: at(col.number) || `INV-${line}`,
      customer,
      issue_date: issue ?? due,
      due_date: due,
      amount,
      paid_amount: Math.max(0, Math.min(paid, amount)),
      paid_date: parseDate(at(col.paid_date))
    });
  }

  return { ok, bad, mapping: describeMapping(headers, col) };
}

/** What the importer decided, so the owner can see it read the file correctly. */
function describeMapping(headers, col) {
  const out = {};
  for (const [field, index] of Object.entries(col)) {
    if (index !== -1) { out[field] = headers[index]; }
  }
  return out;
}
