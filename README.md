# CashFlow

A cash flow decision-support app for an Indian small business. It answers one question:

> **Will I have enough cash next month, and what should I do now?**

Forecasting, risk detection, invoice ageing, reminder drafting and a payment planner. It runs on the owner's own machine and explains itself in plain language using a local AI model — nothing leaves the laptop.

> **Status: half built.** The domain logic, the server and the tests are done and passing. **There is no interface yet** — `npm start` serves the API, but the dashboard is not written, so opening `http://localhost:8080` in a browser gets a 404. See [Where this stands](#where-this-stands).

---

## Running what exists

```bash
cp .env.example .env
npm run demo       # load the sample business
npm start          # API on http://localhost:8080
npm test           # 24 tests
```

Needs **Node 22.5 or newer** — below that `node:sqlite` does not exist and nothing starts.

```bash
curl localhost:8080/api/dashboard | head -c 400
curl -X POST localhost:8080/api/chat -H 'content-type: application/json' \
     -d '{"question":"why am I at risk?"}'
```

**No npm dependencies.** Node ships SQLite, an HTTP server, crypto and a test runner; that is everything this needs. `npm install` does nothing, and there is no dependency to patch at an awkward moment. It runs on the cheapest VPS you can rent, and `data/cashflow.db` is the entire database.

## How it is put together

```
shared/            the domain maths — imported by the server and, later, the browser
  money.js         integer rupees, Indian grouping, Indian date parsing
  forecast.js      90 days × 3 scenarios, recurring-cost detection
  risk.js          RED / AMBER / GREEN, and the reasons behind it
  invoices.js      ageing buckets, reminder drafting
  optimizer.js     which payments may move, and which never may
server/src/
  schema.sql       records only — no derived value is ever stored
  csv.js           imports that reject bad rows instead of guessing
  analysis.js      one function producing every number on screen
  chat.js          local model, with a written fallback
  app.js           routes
```

## The six decisions worth knowing

**1. Wages, tax and EMI are never moved.** The optimizer refuses those categories outright, *even when the data marks them shiftable*. Delaying wages is not a cash flow technique — people have rent of their own. A missed EMI reaches the credit bureau and costs the business its next loan. Statutory dates carry penalties. This is the one place the tool overrules its user, and it is deliberate.

**2. The AI explains; it never calculates.** Every figure is computed in `shared/`. The model receives a small fact sheet — a few dozen already-computed numbers — and is told to answer only from it. It never sees the ledger and is never asked to add anything up. Language models are unreliable at arithmetic and reliable at rephrasing, so they get only the second job. With no model running, the answer is composed from the same facts in code; that path is *more* reliable, just less fluent.

**3. Nothing derived is stored.** No cached forecast, no saved balance, no stored risk level. A stored forecast is wrong the moment a transaction lands, and two screens disagreeing about one number destroys trust in a single glance.

**4. Bad rows are rejected, never coerced.** Every skipped CSV row comes back with its line number and what was wrong with it. A silently misread amount is worse than a missing one, because the total still looks plausible. `03/04/2026` is read as 3 April and never guessed as 4 March.

**5. Whole rupees as integers.** Floats and money do not mix; ninety days of float addition drifts enough to turn an AMBER into a GREEN.

**6. Reminders are drafted, never sent.** The app writes the words and stops. An automatic reminder eventually goes to the customer who paid yesterday in cash, and that costs more than the invoice.

## How the forecast works

Three sources, all visible in the output so any figure traces back to a row:

1. **Outstanding invoices** → money in at `due_date + typical collection delay`, where the delay is the median of your own settled invoices. An already-overdue invoice is expected from *today*, not from a due date that has passed.
2. **Scheduled payments** → money out on their date.
3. **Recurring items found in history** → both directions. Three or more occurrences with a median gap of 25–35 days counts as monthly; anything less regular is left out rather than guessed at. This third source is what makes a forecast honest — a business that forgets its monthly standing costs forecasts a healthy month and then wonders where the cash went.

| Scenario | collections shift | share collected in 90 days | costs |
| --- | --- | --- | --- |
| Expected | — | 100% | as scheduled |
| Optimistic | 7 days earlier | 100% | 3% lower |
| Pessimistic | 21 days later | 80% | 10% higher |

Pessimistic is a normal bad quarter, not a doomsday.

**Risk** is RED when the expected case goes negative within 30 days; AMBER when it goes negative later, or survives only if collections hold, or leaves under 21 days of costs at the trough; GREEN otherwise. The thresholds are named constants in `shared/risk.js` — they are a judgement call and you should be able to disagree with them.

**The optimizer** is greedy, and re-runs the whole forecast for each candidate move rather than estimating the effect — moving a payment past a second dip can make things worse, and only recomputation catches that. It stops as soon as the balance clears zero, so you get the smallest set of changes rather than a rescheduled quarter.

## API

| | |
| --- | --- |
| `GET /api/dashboard` | every number on the dashboard, from one analysis |
| `GET /api/day/:date` | the events behind one day, so "why the dip here" has an answer |
| `GET /api/invoices` | ageing buckets and rows |
| `POST /api/invoices/:id/reminder` | drafts text; sends nothing |
| `POST /api/import/transactions` · `/invoices` | CSV body; returns what imported and what was rejected, with line numbers |
| `POST /api/demo` · `POST /api/reset` | load or clear the sample business |
| `POST /api/chat` | `{question}` → answer plus the facts it was based on |

The chat returns its fact sheet alongside the answer, so the interface can show what the reply was based on. An explanation you cannot check is just a claim.

## Local AI

Install [Ollama](https://ollama.com), then `ollama pull llama3.2`. The app finds it on `127.0.0.1:11434`; set `OLLAMA_URL` / `OLLAMA_MODEL` to change that. If nothing is running, explanations are written from the same numbers instead — no error, no degraded-mode banner.

## Where this stands

**Done and tested:** money and date handling, the forecast and its three scenarios, recurring-cost detection, risk scoring with reasons, invoice ageing, reminder drafting, the payment optimizer with its refusals, CSV import for both file types, the analysis pipeline, the chat with both its local-model and written paths, the HTTP API, and the sample business. 24 tests cover the rules above.

**Not built yet:**

- **The dashboard.** There is no `client/` directory at all — this is the main gap. It needs the 90-day chart, the risk card, the ageing table with reminder buttons, the payment plan, the upload panel and the chat, working at both desktop and phone width.
- The scenario chart palette was mid-validation for colourblind separation when work stopped. Red against green fails deuteranopia badly, so the hues need choosing with a validator rather than by eye.
- API-level tests. The 24 cover `shared/` and the CSV importer, not the routes.
- No authentication. Fine for one machine on a desk; not fine on a public address.

## Out of scope

No bank connection, no payment execution, no GST filing, no accounting ledger, no multi-currency.

And a harder line: **nothing here may hide a transaction.** No second copy of a row, no "exclude from reports" flag, no export that omits what the screen shows.

## History

Commits before `28a63f2` are a different application — an offline-first outstanding-payment tracker for an FMCG distributor, with its own client, sync layer and tests. It was replaced rather than extended, and remains in the history if it is ever wanted.
