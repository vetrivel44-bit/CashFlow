import { readFileSync } from "node:fs";

/** Reads .env if present, then the real environment. No dependency needed. */
function loadEnvFile(path = ".env") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* no .env, use the environment as it is */ }
}

loadEnvFile();

export const config = {
  port: Number(process.env.PORT ?? 8080),
  dbPath: process.env.DB_PATH ?? "./data/cashflow.db",
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean)
};
