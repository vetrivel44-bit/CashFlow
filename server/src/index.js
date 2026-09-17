import { config } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const db = openDb(config.dbPath);
const server = createApp(db, { ollamaUrl: config.ollamaUrl, ollamaModel: config.ollamaModel });

server.listen(config.port, () => {
  const rows = db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n;
  console.log(`[cashflow] http://localhost:${config.port}   db=${config.dbPath}`);
  if (rows === 0) { console.log("[cashflow] no data yet — open the app and press “Load sample data”, or upload a CSV"); }
  console.log(`[cashflow] local AI: ${config.ollamaUrl} (${config.ollamaModel}) — if it is not running, explanations are written from the same numbers instead`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
