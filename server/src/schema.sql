-- CashFlow schema.
--
-- The business's own records, and nothing derived. Every figure the dashboard
-- shows — forecasts, risk levels, ageing, suggested moves — is computed from
-- these tables on each request and never stored. A stored forecast is a
-- forecast that is wrong the moment a transaction lands.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- What actually happened. Direction is in/out; amount is always positive and
-- in whole rupees.
CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  category     TEXT NOT NULL DEFAULT '',
  counterparty TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'manual',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS tx_party ON transactions(counterparty, direction);

-- What customers owe us.
CREATE TABLE IF NOT EXISTS invoices (
  id          TEXT PRIMARY KEY,
  number      TEXT NOT NULL,
  customer    TEXT NOT NULL,
  issue_date  TEXT NOT NULL,
  due_date    TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  paid_amount INTEGER NOT NULL DEFAULT 0,
  paid_date   TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS inv_due ON invoices(due_date);

-- What we know we have to pay. `essential` is the owner's own judgement;
-- the optimizer additionally refuses whole categories outright.
CREATE TABLE IF NOT EXISTS scheduled_payments (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  amount     INTEGER NOT NULL CHECK (amount > 0),
  due_date   TEXT NOT NULL,
  essential  INTEGER NOT NULL DEFAULT 0,
  paid       INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sched_due ON scheduled_payments(due_date);

-- Every import, kept so a bad file can be traced and undone.
CREATE TABLE IF NOT EXISTS imports (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  filename   TEXT NOT NULL DEFAULT '',
  rows_ok    INTEGER NOT NULL DEFAULT 0,
  rows_bad   INTEGER NOT NULL DEFAULT 0,
  notes      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
