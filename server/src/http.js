/**
 * A very small router over node:http. There is no framework here on purpose:
 * this server has to keep running on a ₹400-a-month box for years, maintained
 * by one person, and every dependency is something that eventually needs
 * upgrading at a bad moment.
 */

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export const bad = (code, message) => new HttpError(400, code, message);
export const unauthorized = (message) => new HttpError(401, "unauthorized", message);
export const forbidden = (message) => new HttpError(403, "forbidden", message);
export const notFound = (message) => new HttpError(404, "not_found", message);

export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler, options) => {
    const names = [];
    const rx = new RegExp(
      "^" +
        pattern.replace(/:[A-Za-z_]+/g, (m) => { names.push(m.slice(1)); return "([^/]+)"; }) +
        "$"
    );
    routes.push({ method, rx, names, handler, options: options ?? {} });
  };
  return {
    get: (p, h, o) => add("GET", p, h, o),
    post: (p, h, o) => add("POST", p, h, o),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) { continue; }
        const m = r.rx.exec(pathname);
        if (m) {
          const params = {};
          r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
          return { handler: r.handler, params, options: r.options };
        }
      }
      return null;
    }
  };
}

const MAX_BODY = 2 * 1024 * 1024; // a sync push of a long day is a few hundred KB

export function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(bad("body_too_large", "Send the changes in smaller batches."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(bad("bad_json", "The request body was not valid JSON.")); }
    });
    req.on("error", reject);
  });
}

export function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store"
  });
  res.end(body);
}

export function sendFile(res, status, { body, contentType, filename }) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": buf.length,
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store"
  });
  res.end(buf);
}

/**
 * CORS. The installed app runs from its own origin and calls this server
 * cross-origin, so the allowed origins have to be listed explicitly rather
 * than reflected back — reflecting any origin would let any page a staff
 * member opens read the ledger using their session.
 */
export function corsHeaders(origin, allowed) {
  if (!origin) { return null; }
  const ok = allowed.length === 0
    ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    : allowed.includes(origin);
  if (!ok) { return null; }
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}
