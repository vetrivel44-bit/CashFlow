#!/usr/bin/env node
// node scripts/add-user.js "Appa" owner 4821
// node scripts/add-user.js "Delivery staff" staff 1177
import { config } from "../server/src/config.js";
import { openDb } from "../server/src/db.js";
import { createUser } from "../server/src/auth.js";

const [name, role, pin] = process.argv.slice(2);
if (!name || !role || !pin) {
  console.error('usage: node scripts/add-user.js "<name>" <owner|staff> <4-6 digit pin>');
  process.exit(1);
}
const db = openDb(config.dbPath);
const user = createUser(db, { name, role, pin });
console.log(`added ${user.role}: ${user.name}  (id ${user.id})`);
db.close();
