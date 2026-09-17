#!/usr/bin/env node
// Run on the server when someone forgets their PIN.
// node scripts/reset-pin.js <user-id> 4821
import { config } from "../server/src/config.js";
import { openDb } from "../server/src/db.js";
import { setPin } from "../server/src/auth.js";

const [userId, pin] = process.argv.slice(2);
if (!userId || !pin) {
  console.error("usage: node scripts/reset-pin.js <user-id> <4-6 digit pin>");
  process.exit(1);
}
const db = openDb(config.dbPath);
const user = db.prepare("SELECT name FROM users WHERE id = ?").get(userId);
if (!user) { console.error("no such user"); process.exit(1); }
setPin(db, userId, pin);
console.log(`PIN reset for ${user.name}`);
db.close();
