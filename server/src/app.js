import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { createRouter, readJson, readBody, sendJson, HttpError, bad } from "./http.js";
import { setSetting, getSetting, tx } from "./db.js";
import { importTransactions, importInvoices } from "./csv.js";
import { analyse, factSheet } from "./analysis.js";
import { answer } from "./chat.js";
import { draftReminder, ageInvoices } from "../../shared/invoices.js";
import { demoData } from "./demo-data.js";
import { today as todayISO } from "../../shared/money.js";

export function createApp(db, options = {}) {
  const router = createRouter();
  const now = () => Date.now();

  router.get("/api/health", () => ({ ok: true }));

  // ---- the dashboard, in one call ------------------------------------------
  // Everything on screen comes from a single analysis, so no two tiles can
  // disagree about the same number.
  router.get("/api/dashboard", (ctx, { db, query }) => {
    const a = analyse(db, { asOf: query.get("as_of") ?? undefined });
    return {
      as_of: a.asOf,
      balance_today: a.balanceToday,
      monthly_outflow: a.monthlyOutflow,
      collection_delay: a.collectionDelay,
      counts: a.counts,
      risk: a.risk,
      ageing: a.ageing,
      recurring: a.recurring,
      plan: {
        needed: a.plan.needed,
        solved: a.plan.solved ?? true,
        moves: a.plan.moves,
        blocked: a.plan.blocked,
        before_min: a.plan.before.minBalance,
        after_min: a.plan.after.minBalance,
        gained: a.plan.gained ?? 0
      },
      // The chart wants a light series, not ninety days of event lists.
      series: Object.fromEntries(
        ["expected", "optimistic", "pessimistic"].map((name) => [
          name,
          {
            closing: a.forecasts[name].closing,
            min: a.forecasts[name].minBalance,
            min_date: a.forecasts[name].minDate,
            first_negative: a.forecasts[name].firstNegativeDate,
            points: a.forecasts[name].days.map((d) => ({ date: d.date, balance: d.balance }))
          }
        ])
      )
    };
  });

  /** The events behind one day, so "why does it dip here" has an answer. */
  router.get("/api/day/:date", (ctx, { db, params }) => {
    const a = analyse(db);
    const day = a.forecasts.expected.days.find((d) => d.date === params.date);
    if (!day) { throw bad("out_of_range", "That date is outside the 90-day forecast."); }
    return { date: day.date, balance: day.balance, inflow: day.inflow, outflow: day.outflow, events: day.events };
  });

  // ---- invoices ------------------------------------------------------------

  router.get("/api/invoices", (ctx, { db }) => {
    const rows = db.prepare("SELECT * FROM invoices ORDER BY due_date").all();
    return ageInvoices(rows, todayISO());
  });

  /**
   * Draft a reminder. Drafting only — this endpoint sends nothing and talks to
   * no one. The owner reads it, changes it if they want, and sends it from
   * their own account.
   */
  router.post("/api/invoices/:id/reminder", (ctx, { db, params }) => {
    const row = db.prepare("SELECT * FROM invoices WHERE id = ?").get(params.id);
    if (!row) { throw bad("unknown_invoice", "No such invoice."); }
    const aged = ageInvoices([row], todayISO()).rows[0];
    if (!aged) { throw bad("settled", "That invoice is already settled."); }
    return {
      invoice: aged,
      draft: draftReminder(aged, { business: getSetting(db, "business_name", "our office") }),
      sent: false,
      note: "Nothing has been sent. Copy this, change anything you want, and send it yourself."
    };
  });

  // ---- data in -------------------------------------------------------------

  router.post("/api/import/:kind", async (ctx, { db, req, params }) => {
    const kind = params.kind;
    if (kind !== "transactions" && kind !== "invoices") {
      throw bad("unknown_kind", "Import either transactions or invoices.");
    }
    const text = await readBody(req);
    if (!text.trim()) { throw bad("empty_file", "That file was empty."); }

    const result = kind === "transactions" ? importTransactions(text) : importInvoices(text);
    const importId = randomUUID();

    tx(db, () => {
      if (kind === "transactions") {
        const stmt = db.prepare(
          `INSERT INTO transactions (id, date, direction, amount, category, counterparty, note, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'import', ?)`
        );
        for (const r of result.ok) {
          stmt.run(randomUUID(), r.date, r.direction, r.amount, r.category, r.counterparty, r.note, now());
        }
      } else {
        const stmt = db.prepare(
          `INSERT INTO invoices (id, number, customer, issue_date, due_date, amount, paid_amount, paid_date, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import', ?)`
        );
        for (const r of result.ok) {
          stmt.run(randomUUID(), r.number, r.customer, r.issue_date, r.due_date, r.amount, r.paid_amount, r.paid_date, now());
        }
      }
      db.prepare("INSERT INTO imports (id, kind, filename, rows_ok, rows_bad, notes, created_at) VALUES (?, ?, '', ?, ?, ?, ?)")
        .run(importId, kind, result.ok.length, result.bad.length, JSON.stringify(result.mapping), now());
    });

    return {
      import_id: importId,
      imported: result.ok.length,
      rejected: result.bad.length,
      // Every rejected row comes back with its line number and reason.
      // Nothing is dropped quietly.
      rejects: result.bad.slice(0, 50),
      mapping: result.mapping
    };
  });

  router.post("/api/demo", (ctx, { db }) => {
    const data = demoData();
    tx(db, () => {
      db.exec("DELETE FROM transactions; DELETE FROM invoices; DELETE FROM scheduled_payments; DELETE FROM imports;");
      setSetting(db, "opening_balance", data.openingBalance);
      setSetting(db, "business_name", data.businessName);

      const t = db.prepare(`INSERT INTO transactions (id, date, direction, amount, category, counterparty, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?, '', 'demo', ?)`);
      for (const r of data.transactions) { t.run(randomUUID(), r.date, r.direction, r.amount, r.category, r.counterparty, now()); }

      const i = db.prepare(`INSERT INTO invoices (id, number, customer, issue_date, due_date, amount, paid_amount, paid_date, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'demo', ?)`);
      for (const r of data.invoices) { i.run(randomUUID(), r.number, r.customer, r.issue_date, r.due_date, r.amount, r.paid_amount ?? 0, r.paid_date ?? null, now()); }

      const s = db.prepare(`INSERT INTO scheduled_payments (id, label, category, amount, due_date, essential, paid, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 'demo', ?)`);
      for (const r of data.scheduled) { s.run(randomUUID(), r.label, r.category, r.amount, r.due_date, r.essential ? 1 : 0, now()); }
    });
    return { loaded: true, ...data.counts };
  });

  router.post("/api/reset", (ctx, { db }) => {
    tx(db, () => {
      db.exec("DELETE FROM transactions; DELETE FROM invoices; DELETE FROM scheduled_payments; DELETE FROM imports;");
      setSetting(db, "opening_balance", "0");
    });
    return { cleared: true };
  });

  router.post("/api/settings", (ctx, { db, body }) => {
    if (body.opening_balance !== undefined) { setSetting(db, "opening_balance", Math.round(Number(body.opening_balance) || 0)); }
    if (body.business_name !== undefined) { setSetting(db, "business_name", String(body.business_name).slice(0, 80)); }
    return { ok: true };
  });

  // ---- the explainer -------------------------------------------------------

  router.post("/api/chat", async (ctx, { db, body }) => {
    const question = String(body.question ?? "").slice(0, 500).trim();
    if (!question) { throw bad("no_question", "Ask a question."); }
    const facts = factSheet(analyse(db));
    const reply = await answer(question, facts, {
      url: options.ollamaUrl,
      model: options.ollamaModel,
      useLocalModel: options.useLocalModel
    });
    // The facts go back with the answer so the interface can show what the
    // reply was based on. An explanation you cannot check is just a claim.
    return { question, answer: reply.text, source: reply.source, facts };
  });

  // ---- the app itself ------------------------------------------------------

  const clientDir = fileURLToPath(new URL("../../client/", import.meta.url));
  const sharedDir = fileURLToPath(new URL("../../shared/", import.meta.url));
  const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon"
  };

  async function serveStatic(pathname, res) {
    const fromShared = pathname.startsWith("/shared/");
    const root = fromShared ? sharedDir : clientDir;
    const rel = fromShared ? pathname.slice("/shared/".length)
      : pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    const safe = normalize(rel);
    if (safe.startsWith("..") || safe.includes("\0")) { return false; }
    try {
      const body = await readFile(join(root, safe));
      res.writeHead(200, {
        "content-type": MIME[extname(safe)] ?? "application/octet-stream",
        "content-length": body.length,
        "cache-control": safe === "index.html" ? "no-cache" : "public, max-age=3600"
      });
      res.end(body);
      return true;
    } catch { return false; }
  }

  return createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");

    let url;
    try { url = new URL(req.url, "http://localhost"); }
    catch { sendJson(res, 400, { error: "bad_request" }); return; }

    const hit = router.match(req.method, url.pathname);
    if (!hit) {
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        if (await serveStatic(url.pathname, res)) { return; }
      }
      sendJson(res, 404, { error: "not_found", message: "No such endpoint." });
      return;
    }

    try {
      const isUpload = url.pathname.startsWith("/api/import/");
      const body = req.method === "POST" && !isUpload ? await readJson(req) : {};
      const out = await hit.handler({}, { db, body, req, query: url.searchParams, params: hit.params });
      sendJson(res, 200, out ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) { sendJson(res, err.status, { error: err.code, message: err.message }); return; }
      console.error("[cashflow]", err);
      sendJson(res, 500, { error: "server_error", message: "Something went wrong on the server." });
    }
  });
}
