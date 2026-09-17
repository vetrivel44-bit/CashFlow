#!/usr/bin/env node
/**
 * Sample data, so the app can be opened and understood before a single real
 * shop has been entered. Never run this against the real database.
 *
 *   node server/src/seed.js
 */
import { config } from "./config.js";
import { openDb, nextSeq } from "./db.js";
import { createUser } from "./auth.js";

const db = openDb(config.dbPath);

if (db.prepare("SELECT COUNT(*) AS n FROM entries").get().n > 0) {
  console.error("There is already a ledger in " + config.dbPath + ". Refusing to seed over it.");
  process.exit(1);
}

const owner = createUser(db, { name: "Owner", role: "owner", pin: "4821" });
const staff = createUser(db, { name: "Delivery staff", role: "staff", pin: "1177" });

const now = Date.now();
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const routes = [["route-tenkasi", "Tenkasi Road"], ["route-market", "Market Street"], ["route-bus", "Bus Stand"]];
for (const [id, name] of routes) {
  db.prepare("INSERT INTO routes (id, name, updated_at, updated_by, seq) VALUES (?, ?, ?, ?, ?)")
    .run(id, name, now, staff.id, nextSeq(db));
}

const shops = [
  ["shop-murugan", "Murugan Stores", "9842011221", "route-tenkasi"],
  ["shop-amman", "Amman Market", "9842033445", "route-bus"],
  ["shop-raja", "Raja Fancy Store", "9842055667", "route-market"],
  ["shop-selvi", "Selvi Stores", "9842077889", "route-tenkasi"],
  ["shop-kannan", "Kannan Traders", "9842099001", "route-market"],
  ["shop-selvam", "Selvam Agency", "9842011002", "route-tenkasi"],
  ["shop-lakshmi", "Lakshmi Stores", "", "route-bus"],
  ["shop-ganesh", "New Ganesh Stores", "9842033004", "route-market"],
  ["shop-balaji", "Sri Balaji Mart", "9842055006", "route-bus"],
  ["shop-vijay", "Vijay Super Market", "9842077008", "route-tenkasi"]
];
for (const [id, name, phone, routeId] of shops) {
  db.prepare("INSERT INTO shops (id, name, phone, route_id, archived, updated_at, updated_by, seq) VALUES (?, ?, ?, ?, 0, ?, ?, ?)")
    .run(id, name, phone, routeId, now, staff.id, nextSeq(db));
}

let n = 0;
const entry = (shopId, kind, amount, ago) =>
  db.prepare(
    `INSERT INTO entries (id, shop_id, kind, amount, entry_date, reversed_by, reversal_of, created_at, created_by, device_id, seq)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, '', ?)`
  ).run("seed-" + ++n, shopId, kind, amount, day(ago), now, staff.id, nextSeq(db));

entry("shop-murugan", "opening", 48400, 41);
entry("shop-amman", "opening", 18000, 26);   entry("shop-amman", "payment", 5050, 6);
entry("shop-raja", "delivery", 6200, 14);    entry("shop-raja", "payment", 3000, 0);
entry("shop-selvi", "opening", 9150, 22);    entry("shop-selvi", "payment", 5000, 4);
entry("shop-kannan", "delivery", 2800, 3);   entry("shop-kannan", "payment", 1200, 0);
entry("shop-selvam", "opening", 12000, 30);  entry("shop-selvam", "payment", 12000, 2);
entry("shop-lakshmi", "delivery", 15600, 19);
entry("shop-ganesh", "delivery", 4300, 8);
entry("shop-balaji", "opening", 21000, 34);  entry("shop-balaji", "payment", 9000, 11);
entry("shop-vijay", "delivery", 7400, 5);

console.log("Seeded " + shops.length + " shops.");
console.log("  Owner           PIN 4821");
console.log("  Delivery staff  PIN 1177");
db.close();
