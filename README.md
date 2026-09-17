# CashFlow Ledger

An outstanding-payment tracker for a wholesale FMCG distributor in Tamil Nadu. It answers one question — **who owes how much, and for how long** — and does nothing else.

Two phones share one ledger. The owner's phone is one screen he reads and never types into. A staff phone records deliveries and payments and keeps the shop list. Both work with no signal.

This repository is the backend and the data layer. The interface is designed in a separate [design system](https://claude.ai/artifact/RfZ2gzHm7oRTNhqDdu7w6H) and previewed as a [working model](https://claude.ai/artifact/G3A6uCNPGLnCzyeTHKngpd).

---

## Running it

```bash
cp .env.example .env
npm run seed       # sample shops + two accounts, to see it working
npm start          # the whole app: http://localhost:8080
npm test           # 19 tests, no network needed
```

Open it and sign in. `npm run seed` prints the two PINs — owner `4821`, staff `1177`.
For a real setup, skip the seed and make the accounts yourself:

```bash
node scripts/add-user.js "Appa" owner 4821
node scripts/add-user.js "Delivery staff" staff 1177
```

The server serves the app as well as the API, on one origin. There is no
separate build step and no bundler: the browser loads the ES modules directly.

**There are no npm dependencies.** Node 22.5+ ships SQLite (`node:sqlite`), an HTTP server, crypto, a test runner and zlib — everything this server needs. `npm install` does nothing, `node_modules` stays empty, and there is no dependency to patch at an awkward moment. The `.xlsx` writer is 120 lines in `server/src/xlsx.js` for the same reason.

It runs on the cheapest VPS you can rent. One file (`data/cashflow.db`) is the whole database; copying it is a complete backup.

## How it is put together

```
server/src/
  schema.sql        the ledger: append-only entries, shops, routes, devices, audit
  db.js             open, transactions, the change sequence
  ledger.js         balance, ageing, the outstanding list  ← the business rules
  auth.js           PIN login, device tokens, read-only owner
  http.js           a ~100-line router over node:http
  xlsx.js           a minimal .xlsx writer, and CSV with a BOM
  routes/sync.js    pull/push between phones and server
  routes/reports.js outstanding, print sheet, day close, shop ledger, exports
client/src/
  store.js          the phone's IndexedDB copy — the app's only data source
  sync.js           the background push/pull loop
  drive-backup.js   nightly backup to the owner's OWN Google Drive
```

## The five decisions worth knowing

**1. Nothing is ever deleted.** There is no `DELETE` anywhere in this server. A wrong entry is *reversed*: the mistake keeps its row and gains a `reversed_by`, and a second row records the correction. Both are visible for ever. A shop that stops buying is *archived*, never removed.

The one subtlety, and the bug the tests caught while this was written: a correction is **two** rows, and **neither** of them counts as money. Excluding only the reversed one cancels the mistake twice and moves the balance the wrong way. See `live()` in `server/src/ledger.js`.

**2. No total is ever stored.** Balances, day counts and the outstanding list are computed from the entry table on every read. Two phones cannot disagree about a number that neither of them stores, and a report can never be stale.

**3. Payments settle the oldest delivery first.** That is how the trade settles, and it means a shop that pays part of an old bill gets credit for its age, while a shop that pays for this week's goods with last month's still unpaid does not get its day count reset.

**4. Entries are immutable and carry a client-generated id.** So pushing the same batch twice is a no-op, a phone that loses signal mid-push can retry forever, and a payment can never be double-counted. This is what makes sync safe over a bad connection without a single conflict dialogue.

**5. The owner's phone is read-only on the server.** Enforced in `requireStaff()`, not by hiding buttons. A role check on the server is the difference between a design decision and a guarantee.

## Offline, and what the network is for

The phone is the source of truth for what happened. Every screen reads IndexedDB and never the network, which is why the interface has no loading states and no offline banner — offline is the normal state of a phone in a delivery area, not a fault to report.

`client/src/sync.js` pushes the outbox and pulls anything new whenever it can, with exponential backoff, and gives up quietly when it cannot. Pull is `GET /api/sync?since=N`, where N is a server-assigned sequence number, not a timestamp — two phones with wrong clocks still agree on the order the server accepted things in.

## Backup goes to his Drive, not ours

`client/src/drive-backup.js` uploads the whole ledger as plain JSON to the **owner's own Google Drive**, straight from his phone. The backup never passes through this server and this server never holds a Google credential. Scope is `drive.file`, which can only see files this app created — connecting the backup cannot read anything else in his Drive.

The printed sheet is still the backup he actually relies on. This one is for the day the phone is lost.

## API

All endpoints need `Authorization: Bearer <token>` except the first three.

| | |
| --- | --- |
| `GET /api/health` | liveness |
| `GET /api/auth/users` | names and roles for the sign-in screen |
| `POST /api/auth/login` | `{user_id, pin}` → device token |
| `GET /api/sync?since=N` | everything written after N |
| `POST /api/sync` | push routes, shops, entries, reversals (staff only) |
| `GET /api/reports/outstanding` | who owes what, worst overdue first |
| `GET /api/reports/print-sheet` | the same, plus today's collections |
| `GET /api/reports/day-close` | the midnight handover figure |
| `GET /api/shops/:id/ledger` | one shop's history with running balance |
| `GET /api/export.xlsx` · `.csv` | for the accountant |
| `GET /api/backup.json` | the whole ledger, for the Drive backup |

Login is a **PIN**, not a password, because the owner does not type — 4 to 6 digits on the same number pad he uses for money. Short PINs are only safe if guessing is slow and bounded, so they are stretched with scrypt, failures lock the account for ten minutes, and a successful login issues a long random device token that is stored hashed.

## What this will never do

No billing, no GST invoices, no stock, no expiry, no schemes, no GPS, no vehicle management. Those are out of scope for this release.

And a harder line, in the code as well as the documentation: **there is no way to hide a transaction.** No second copy of an entry, no "exclude from reports" flag, no export that omits rows that exist in the database. Every report includes every shop that owes money, every export contains everything, and the printed sheet carries no GST number, no invoice number and no signature line — so it can never be mistaken for a bill. See `docs/BOUNDARIES.md`.

## Installing it on a phone

`client/manifest.webmanifest` and `client/sw.js` make it installable: open the
site in Chrome, *Add to home screen*, and it gets an icon and opens without
browser chrome. The service worker caches the app shell so it still opens with
no signal, and deliberately never caches an `/api/` response — the ledger lives
in IndexedDB, and a stale cached response would be a second, older copy of the
truth competing with it.

## Still to build

- Tamil wording reviewed by someone who uses these words daily. What is there
  is a first pass and should not go in front of a customer as it stands.
- A nightly trigger for the Drive backup, and the screen that connects it.
- Deployment: systemd unit, TLS, `data/` on a volume that gets backed up.
- Pagination on `GET /api/sync?since=0`. A first sync after a few years of
  entries will be one large response; it is fine for now and will not be
  forever.
