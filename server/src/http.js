/**
 * A small router over node:http. No framework: this has to keep running on a
 * cheap box for years, maintained by one person, and every dependency is
 * something that eventually needs upgrading at a bad moment.
 */

export class HttpError extends Error {
  constructor(status, code, message) { super(message ?? code); this.status = status; this.code = code; }
}
export const bad = (code, message) => new HttpError(400, code, message);
export const notFound = (message) => new HttpError(404, "not_found", message);

export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const names = [];
    const rx = new RegExp("^" + pattern.replace(/:[A-Za-z_]+/g, (m) => { names.push(m.slice(1)); return "([^/]+)"; }) + "$");
    routes.push({ method, rx, names, handler });
  };
  return {
    get: (p, h) => add("GET", p, h),
    post: (p, h) => add("POST", p, h),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) { continue; }
        const m = r.rx.exec(pathname);
        if (m) {
          const params = {};
          r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
          return { handler: r.handler, params };
        }
      }
      return null;
    }
  };
}

// A year of transactions as CSV is a few hundred KB; 8 MB is generous and
// still small enough that a bad upload cannot exhaust memory.
const MAX_BODY = 8 * 1024 * 1024;

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(bad("body_too_large", "That file is too large. Split it, or send a shorter date range.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) { return {}; }
  try { return JSON.parse(raw); }
  catch { throw bad("bad_json", "The request body was not valid JSON."); }
}

export function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.length, "cache-control": "no-store" });
  res.end(body);
}
