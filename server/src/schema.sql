-- CashFlow Ledger schema.
--
-- Two rules shape this file:
--
--   1. Nothing is ever deleted. There is no DELETE anywhere in the server.
--      A wrong entry is reversed by a new entry; a shop that stops buying is
--      archived. Every row that was ever written stays readable.
--
--   2. Money lives in one append-only table. `entries` rows are immutable
--      facts: once written, only `reversed_by` may ever change, and only from
--      NULL to an id, once. Balances are derived, never stored, so two phones
--      can never disagree about a total they each computed from the same facts.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- A single monotonic counter. Every write takes the next value and stamps the
-- row with it, so a client can ask "everything after seq N" and get exactly
-- what it has not seen, in order, with no clock involved.
CREATE TABLE IF NOT EXISTS change_seq (
  id  INTEGER PRIMARY KEY CHECK (id = 1),
  val INTEGER NOT NULL
);
INSERT OR IGNORE INTO change_seq (id, val) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  pin_salt   TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- One row per phone that has logged in. The token is stored hashed, so a copy
-- of the database does not hand anyone a working session.
CREATE TABLE IF NOT EXISTS devices (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  label      TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);

CREATE TABLE IF NOT EXISTS routes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  seq        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS routes_seq ON routes(seq);

CREATE TABLE IF NOT EXISTS shops (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  route_id   TEXT NOT NULL REFERENCES routes(id),
  archived   INTEGER NOT NULL DEFAULT 0,
  reminded_on TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  seq        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shops_seq ON shops(seq);
CREATE INDEX IF NOT EXISTS shops_route ON shops(route_id);

-- The ledger. Append only.
--
-- kind      'opening'  what the notebook already showed when the shop was registered
--           'delivery' goods given on credit
--           'payment'  money received
-- amount    whole rupees, always positive. Paise do not exist in this ledger.
-- entry_date the business date the entry belongs to, 'YYYY-MM-DD', from the
--           device clock at the moment of entry. Never edited afterwards.
-- reversed_by  set once, to the id of the entry that cancels this one.
-- reversal_of  set at creation, to the id of the entry this one cancels.
CREATE TABLE IF NOT EXISTS entries (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  kind        TEXT NOT NULL CHECK (kind IN ('opening', 'delivery', 'payment')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  entry_date  TEXT NOT NULL,
  reversed_by TEXT REFERENCES entries(id),
  reversal_of TEXT REFERENCES entries(id),
  created_at  INTEGER NOT NULL,
  created_by  TEXT NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  seq         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_seq ON entries(seq);
CREATE INDEX IF NOT EXISTS entries_shop ON entries(shop_id, entry_date);
CREATE INDEX IF NOT EXISTS entries_date ON entries(entry_date);

-- Every state-changing request, kept for the life of the database. This is the
-- answer to "who recorded that, and from which phone" at two in the morning.
CREATE TABLE IF NOT EXISTS audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  user_id    TEXT NOT NULL DEFAULT '',
  device_id  TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
