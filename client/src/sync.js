/**
 * Sync.
 *
 * Deliberately boring, and deliberately invisible. It runs when it can and
 * gives up quietly when it cannot. It never blocks a screen, never shows a
 * spinner, and never puts an error in front of the owner: an offline phone is
 * the normal state of a phone in a delivery area, not a fault to report.
 *
 * The contract with the server that makes this safe:
 *   - entries carry client-generated ids and are immutable, so pushing the
 *     same batch twice is a no-op and retrying forever is harmless;
 *   - the server returns a per-item result, so one bad row never blocks the
 *     good ones queued behind it.
 */

const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 5 * 60 * 1000;
const PUSH_BATCH = 200;

export class Api {
  constructor(baseUrl, getToken) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.getToken = getToken;
  }

  async call(method, path, body) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(this.getToken() ? { authorization: "Bearer " + this.getToken() } : {}),
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) { throw Object.assign(new Error("signed_out"), { signedOut: true }); }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw Object.assign(new Error(detail.message ?? "request_failed"), { code: detail.error, status: res.status });
    }
    return res.json();
  }

  login(userId, pin, label) { return this.call("POST", "/api/auth/login", { user_id: userId, pin, label }); }
  users() { return this.call("GET", "/api/auth/users"); }
  pull(since) { return this.call("GET", `/api/sync?since=${since}`); }
  push(batch) { return this.call("POST", "/api/sync", batch); }
  backup() { return this.call("GET", "/api/backup.json"); }
}

export class Sync {
  /**
   * @param onChange called after anything lands locally, so the app re-renders.
   * @param onSignedOut called when the token stops working.
   */
  constructor(store, api, { onChange = () => {}, onSignedOut = () => {} } = {}) {
    this.store = store;
    this.api = api;
    this.onChange = onChange;
    this.onSignedOut = onSignedOut;
    this.failures = 0;
    this.running = false;
    this.timer = null;
  }

  start() {
    addEventListener("online", () => this.runSoon(0));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { this.runSoon(0); } });
    this.runSoon(0);
  }

  stop() { clearTimeout(this.timer); this.timer = null; }

  runSoon(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), ms);
  }

  /** Call after any local write, so a payment reaches the other phone promptly. */
  nudge() { this.runSoon(300); }

  async run() {
    if (this.running || !navigator.onLine) { return; }
    this.running = true;
    try {
      await this.pushOutbox();
      await this.pullChanges();
      this.failures = 0;
      this.runSoon(60_000);          // a quiet heartbeat when all is well
    } catch (err) {
      if (err.signedOut) { this.stop(); this.onSignedOut(); return; }
      this.failures += 1;
      this.runSoon(Math.min(RETRY_BASE_MS * 2 ** (this.failures - 1), RETRY_MAX_MS));
    } finally {
      this.running = false;
    }
  }

  async pushOutbox() {
    const queued = await this.store.outbox();
    if (queued.length === 0) { return; }

    for (let i = 0; i < queued.length; i += PUSH_BATCH) {
      const slice = queued.slice(i, i + PUSH_BATCH);
      const batch = { routes: [], shops: [], entries: [], reversals: [] };
      const keyOf = new Map();

      for (const row of slice) {
        const bucket = { route: "routes", shop: "shops", entry: "entries", reversal: "reversals" }[row.kind];
        batch[bucket].push(row.item);
        keyOf.set(`${row.kind}:${row.item.id}`, row.key);
      }

      const res = await this.api.push(batch);

      // Clear anything the server has settled. "rejected" is settled too: the
      // row will never be accepted, so retrying it forever would block the
      // queue behind it. It stays visible in the local ledger and in the audit
      // trail, and the mismatch surfaces the next time someone reads the shop.
      const settled = res.results
        .filter((r) => ["ok", "duplicate", "stale", "already_reversed", "rejected"].includes(r.status))
        .map((r) => keyOf.get(`${r.kind}:${r.id}`))
        .filter(Boolean);

      await this.store.clearOutbox(settled);

      const refused = res.results.filter((r) => r.status === "rejected");
      if (refused.length) { console.warn("[sync] server refused", refused); }
    }
  }

  async pullChanges() {
    const since = await this.store.meta("since", 0);
    const data = await this.api.pull(since);
    const count = data.routes.length + data.shops.length + data.entries.length;
    if (count > 0 || data.seq !== since) {
      await this.store.acceptFromServer(data, data.seq);
      if (count > 0) { this.onChange(); }
    }
  }
}
