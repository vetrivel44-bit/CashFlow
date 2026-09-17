#!/usr/bin/env node
// Load the sample business into the database without starting the server.
import { config } from "./config.js";
import { openDb, setSetting, tx } from "./db.js";
import { demoData } from "./demo-data.js";
import { randomUUID } from "node:crypto";

const db = openDb(config.dbPath);
const data = demoData();
const now = Date.now();

tx(db, () => {
  db.exec("DELETE FROM transactions; DELETE FROM invoices; DELETE FROM scheduled_payments; DELETE FROM imports;");
  setSetting(db, "opening_balance", data.openingBalance);
  setSetting(db, "business_name", data.businessName);
  const t = db.prepare(`INSERT INTO transactions (id, date, direction, amount, category, counterparty, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?, '', 'demo', ?)`);
  for (const r of data.transactions) { t.run(randomUUID(), r.date, r.direction, r.amount, r.category, r.counterparty, now); }
  const i = db.prepare(`INSERT INTO invoices (id, number, customer, issue_date, due_date, amount, paid_amount, paid_date, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'demo', ?)`);
  for (const r of data.invoices) { i.run(randomUUID(), r.number, r.customer, r.issue_date, r.due_date, r.amount, r.paid_amount ?? 0, r.paid_date ?? null, now); }
  const s = db.prepare(`INSERT INTO scheduled_payments (id, label, category, amount, due_date, essential, paid, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 'demo', ?)`);
  for (const r of data.scheduled) { s.run(randomUUID(), r.label, r.category, r.amount, r.due_date, r.essential ? 1 : 0, now); }
});

console.log(`Loaded ${data.businessName}: ${data.counts.transactions} transactions, ${data.counts.invoices} invoices, ${data.counts.scheduled} scheduled payments.`);
db.close();
