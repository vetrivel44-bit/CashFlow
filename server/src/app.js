import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter, readJson, sendJson, sendFile, corsHeaders, HttpError, notFound, bad } from "./http.js";
import { authenticate, login, createUser, setPin, revokeDevice } from "./auth.js";
import { pull, push } from "./routes/sync.js";
import * as reports from "./routes/reports.js";

export function createApp(db, { allowedOrigins = [] } = {}) {
  const router = createRouter();

  // ---- open ----------------------------------------------------------------

  router.get("/api/health", () => ({ ok: true }));

  /**
   * The sign-in list. Names and roles only — never a hint about the PIN, and
   * never anything that identifies the business. The owner taps his name and
   * enters a PIN on the same number pad he uses for money.
   */
  router.get("/api/auth/users", (ctx, { db }) => ({
    users: db.prepare("SELECT id, name, role FROM users WHERE active = 1 ORDER BY role DESC, name").all()
  }));

  router.post("/api/auth/login", (ctx, { db, body }) =>
    login(db, { userId: body.user_id, pin: body.pin, label: body.label })
  );

  // ---- signed in -----------------------------------------------------------

  router.get("/api/me", (ctx) => ({ user: ctx.user, device: ctx.device }), { auth: true });

  router.post("/api/auth/logout", (ctx, { db }) => {
    revokeDevice(db, ctx.device.id);
    return { ok: true };
  }, { auth: true });

  router.post("/api/auth/pin", (ctx, { db, body }) => {
    // A PIN is a person's own. Only the account holder changes it here;
    // a forgotten one is reset from the box with scripts/reset-pin.js.
    setPin(db, ctx.user.id, body.pin);
    return { ok: true };
  }, { auth: true });

  router.post("/api/users", (ctx, { db, body }) => {
    if (ctx.user.role !== "owner") { throw new HttpError(403, "forbidden", "Only the owner adds accounts."); }
    return { user: createUser(db, { name: body.name, role: body.role, pin: body.pin }) };
  }, { auth: true });

  router.get("/api/sync", (ctx, { db, query }) => pull(db, ctx, query), { auth: true });
  router.post("/api/sync", (ctx, { db, body }) => push(db, ctx, body), { auth: true });

  router.get("/api/reports/outstanding", (ctx, { db, query }) => reports.outstanding(db, ctx, query), { auth: true });
  router.get("/api/reports/print-sheet", (ctx, { db, query }) => reports.printSheet(db, ctx, query), { auth: true });
  router.get("/api/reports/day-close", (ctx, { db, query }) => reports.dayClose(db, ctx, query), { auth: true });
  router.get("/api/shops/:shopId/ledger", (ctx, { db, params, query }) => reports.shopLedger(db, ctx, params, query), { auth: true });
  router.get("/api/backup.json", (ctx, { db }) => reports.backupJson(db), { auth: true });

  router.get("/api/export.xlsx", (ctx, { db, query }) => ({ __file: reports.exportXlsx(db, ctx, query) }), { auth: true });
  router.get("/api/export.csv", (ctx, { db, query }) => ({ __file: reports.exportCsv(db, ctx, query) }), { auth: true });

  // The app is served by the same server that holds the ledger. One origin
  // means no CORS to configure, no third-party host to trust, and one thing to
  // deploy — which matters when the person maintaining this is also the person
  // driving the delivery van on a bad day.
  const clientDir = fileURLToPath(new URL("../../client/", import.meta.url));
  // shared/ledger.js is imported by the app as well as the server, so it is
  // served from its own root rather than copied into client/. One copy of the
  // ledger rules, byte for byte, on both sides.
  const sharedDir = fileURLToPath(new URL("../../shared/", import.meta.url));
  const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
    ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon"
  };

  async function serveStatic(pathname, res) {
    const fromShared = pathname.startsWith("/shared/");
    const root = fromShared ? sharedDir : clientDir;
    const rel = fromShared
      ? pathname.slice("/shared/".length)
      : pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    // normalize() then reject anything that climbed out: a request for
    // ../../.env must not be able to read the server's own files.
    const safe = normalize(rel);
    if (safe.startsWith("..") || safe.includes("\0")) { return false; }
    try {
      const body = await readFile(join(root, safe));
      const type = MIME[extname(safe)] ?? "application/octet-stream";
      res.writeHead(200, {
        "content-type": type,
        "content-length": body.length,
        // The service worker must never be served stale, or a phone can be
        // stuck on an old app for as long as the cache lives.
        "cache-control": safe === "sw.js" || safe === "index.html" ? "no-cache" : "public, max-age=3600"
      });
      res.end(body);
      return true;
    } catch { return false; }
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = corsHeaders(origin, allowedOrigins);
    if (cors) { for (const [k, v] of Object.entries(cors)) { res.setHeader(k, v); } }
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");

    if (req.method === "OPTIONS") { res.writeHead(cors ? 204 : 403).end(); return; }
    if (origin && !cors) { sendJson(res, 403, { error: "forbidden", message: "This origin is not allowed." }); return; }

    let url;
    try { url = new URL(req.url, "http://localhost"); }
    catch { sendJson(res, 400, { error: "bad_request" }); return; }

    const hit = router.match(req.method, url.pathname);
    if (!hit) {
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        if (await serveStatic(url.pathname, res)) { return; }
      }
      sendJson(res, 404, { error: "not_found", message: "No such endpoint." });
      return;
    }

    try {
      const ctx = hit.options.auth ? authenticate(db, req) : {};
      const body = req.method === "POST" ? await readJson(req) : {};
      const out = await hit.handler(ctx, { db, body, query: url.searchParams, params: hit.params });

      if (out && out.__file) { sendFile(res, 200, out.__file); return; }
      sendJson(res, 200, out ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.code, message: err.message });
        return;
      }
      // Never leak a stack trace to a phone; keep it in the server log.
      console.error("[cashflow]", err);
      sendJson(res, 500, { error: "server_error", message: "Something went wrong on the server." });
    }
  });

  return server;
}
