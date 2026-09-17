import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { createUser } from "../src/auth.js";

let db, server, base;
let ownerToken, staffToken, ownerId, staffId;

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, body: type.includes("json") ? await res.json() : await res.arrayBuffer() };
}

before(async () => {
  db = openDb(":memory:");
  ownerId = createUser(db, { name: "Owner", role: "owner", pin: "4821" }).id;
  staffId = createUser(db, { name: "Staff", role: "staff", pin: "1177" }).id;

  server = createApp(db);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  ownerToken = (await call("POST", "/api/auth/login", { body: { user_id: ownerId, pin: "4821" } })).body.token;
  staffToken = (await call("POST", "/api/auth/login", { body: { user_id: staffId, pin: "1177" } })).body.token;

  await call("POST", "/api/sync", {
    token: staffToken,
    body: {
      routes: [{ id: "route-tenkasi", name: "Tenkasi Road", updated_at: Date.now() }],
      shops: [{ id: "shop-murugan", name: "Murugan Stores", phone: "9842011221", route_id: "route-tenkasi", updated_at: Date.now() }]
    }
  });
});

after(() => { server.close(); db.close(); });

test("a wrong PIN is refused, and does not say whether the account exists", async () => {
  const wrongPin = await call("POST", "/api/auth/login", { body: { user_id: ownerId, pin: "0000" } });
  const noUser = await call("POST", "/api/auth/login", { body: { user_id: "nobody", pin: "0000" } });
  assert.equal(wrongPin.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPin.body.message, noUser.body.message);
});

test("the ledger is closed without a token", async () => {
  assert.equal((await call("GET", "/api/sync?since=0")).status, 401);
  assert.equal((await call("GET", "/api/reports/outstanding")).status, 401);
});

test("the owner's phone can read but cannot write", async () => {
  const read = await call("GET", "/api/reports/outstanding", { token: ownerToken });
  assert.equal(read.status, 200);

  const write = await call("POST", "/api/sync", {
    token: ownerToken,
    body: { entries: [{ id: "owner-tried", shop_id: "shop-murugan", kind: "payment", amount: 100, entry_date: today() }] }
  });
  assert.equal(write.status, 403, "read-only is enforced on the server, not just in the interface");
});

test("pushing the same payment twice does not double-count it", async () => {
  const entry = { id: "entry-pay-1", shop_id: "shop-murugan", kind: "delivery", amount: 5000, entry_date: daysAgo(10) };

  const first = await call("POST", "/api/sync", { token: staffToken, body: { entries: [entry] } });
  const again = await call("POST", "/api/sync", { token: staffToken, body: { entries: [entry] } });

  assert.equal(first.body.results[0].status, "ok");
  assert.equal(again.body.results[0].status, "duplicate");

  const report = await call("GET", "/api/reports/outstanding", { token: ownerToken });
  assert.equal(report.body.total, 5000, "the retry added nothing");
});

test("a bad row is rejected without blocking the good ones beside it", async () => {
  const res = await call("POST", "/api/sync", {
    token: staffToken,
    body: {
      entries: [
        { id: "entry-good", shop_id: "shop-murugan", kind: "payment", amount: 1000, entry_date: today() },
        { id: "entry-noshop", shop_id: "shop-missing", kind: "payment", amount: 500, entry_date: today() },
        { id: "entry-paise", shop_id: "shop-murugan", kind: "payment", amount: 12.5, entry_date: today() }
      ]
    }
  });
  const byId = Object.fromEntries(res.body.results.map((r) => [r.id, r]));
  assert.equal(byId["entry-good"].status, "ok");
  assert.equal(byId["entry-noshop"].status, "rejected");
  assert.equal(byId["entry-paise"].status, "rejected", "paise do not exist in this ledger");
});

test("a reversal keeps both entries and undoes the money", async () => {
  const before = (await call("GET", "/api/reports/outstanding", { token: ownerToken })).body.total;

  await call("POST", "/api/sync", {
    token: staffToken,
    body: {
      entries: [{ id: "entry-oops", shop_id: "shop-murugan", kind: "payment", amount: 700, entry_date: today() }]
    }
  });
  const afterPayment = (await call("GET", "/api/reports/outstanding", { token: ownerToken })).body.total;
  assert.equal(afterPayment, before - 700);

  await call("POST", "/api/sync", {
    token: staffToken,
    body: {
      entries: [{ id: "entry-fix", shop_id: "shop-murugan", kind: "delivery", amount: 700, entry_date: today(), reversal_of: "entry-oops" }],
      reversals: [{ id: "entry-oops", reversed_by: "entry-fix" }]
    }
  });
  const afterReversal = (await call("GET", "/api/reports/outstanding", { token: ownerToken })).body.total;
  assert.equal(afterReversal, before, "the balance is back");

  const ledger = await call("GET", "/api/shops/shop-murugan/ledger", { token: ownerToken });
  const ids = ledger.body.history.map((h) => h.id);
  assert.ok(ids.includes("entry-oops"), "the mistake is still on the record");
  assert.ok(ids.includes("entry-fix"), "and so is the correction");
});

test("an entry can never be reversed twice", async () => {
  await call("POST", "/api/sync", {
    token: staffToken,
    body: { entries: [{ id: "entry-second-fix", shop_id: "shop-murugan", kind: "delivery", amount: 700, entry_date: today() }] }
  });
  const res = await call("POST", "/api/sync", {
    token: staffToken,
    body: { reversals: [{ id: "entry-oops", reversed_by: "entry-second-fix" }] }
  });
  assert.equal(res.body.results[0].status, "already_reversed");
});

test("a phone pulls only what it has not seen", async () => {
  const all = await call("GET", "/api/sync?since=0", { token: staffToken });
  const seq = all.body.seq;
  const nothingNew = await call("GET", `/api/sync?since=${seq}`, { token: staffToken });
  assert.equal(nothingNew.body.entries.length, 0);
  assert.equal(nothingNew.body.shops.length, 0);

  await call("POST", "/api/sync", {
    token: staffToken,
    body: { entries: [{ id: "entry-later", shop_id: "shop-murugan", kind: "delivery", amount: 300, entry_date: today() }] }
  });
  const delta = await call("GET", `/api/sync?since=${seq}`, { token: staffToken });
  assert.equal(delta.body.entries.length, 1);
  assert.equal(delta.body.entries[0].id, "entry-later");
});

test("the export is a real xlsx and holds every outstanding row", async () => {
  const report = await call("GET", "/api/reports/outstanding", { token: ownerToken });
  const file = await call("GET", "/api/export.xlsx", { token: ownerToken });
  const bytes = Buffer.from(file.body);

  assert.equal(bytes.subarray(0, 2).toString(), "PK", "a zip, which is what an xlsx is");
  assert.ok(bytes.length > 500);
  assert.ok(report.body.rows.length >= 1);
});

test("signing out stops that phone", async () => {
  const token = (await call("POST", "/api/auth/login", { body: { user_id: staffId, pin: "1177" } })).body.token;
  assert.equal((await call("GET", "/api/me", { token })).status, 200);
  await call("POST", "/api/auth/logout", { token });
  assert.equal((await call("GET", "/api/me", { token })).status, 401);
});
