import { config } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const db = openDb(config.dbPath);
const server = createApp(db, { allowedOrigins: config.allowedOrigins });

server.listen(config.port, () => {
  const users = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  console.log(`[cashflow] listening on :${config.port}  db=${config.dbPath}`);
  if (users === 0) {
    console.log("[cashflow] no accounts yet — run: node scripts/add-user.js \"Owner name\" owner 1234");
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => { db.close(); process.exit(0); });
  });
}
