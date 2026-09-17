import { readFileSync } from "node:fs";

function loadEnvFile(path = ".env") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) { process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
    }
  } catch { /* no .env; use the environment as it is */ }
}
loadEnvFile();

export const config = {
  port: Number(process.env.PORT ?? 8080),
  dbPath: process.env.DB_PATH ?? "./data/cashflow.db",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.2"
};
