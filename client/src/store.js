/**
 * The phone's copy of the ledger.
 *
 * This is the app's only data source. Every screen reads from here and never
 * from the network, which is why there is no loading state anywhere in the
 * interface: the answer is already on the phone. The network's job is to carry
 * changes to the other phone eventually, not to serve a screen.
 *
 * IndexedDB rather than localStorage: a few hundred shops and years of entries
 * is more than localStorage should hold, and a half-written localStorage blob
 * loses everything while IndexedDB loses one transaction.
 */

const DB_NAME = "cashflow";
const DB_VERSION = 1;

export function openStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("routes")) { db.createObjectStore("routes", { keyPath: "id" }); }
      if (!db.objectStoreNames.contains("shops")) { db.createObjectStore("shops", { keyPath: "id" }); }
      if (!db.objectStoreNames.contains("entries")) {
        const s = db.createObjectStore("entries", { keyPath: "id" });
        s.createIndex("shop", "shop_id");
        s.createIndex("date", "entry_date");
      }
      // Changes made on this phone that the server has not confirmed yet.
      // They are already real to the user; this queue is only about delivery.
      if (!db.objectStoreNames.contains("outbox")) { db.createObjectStore("outbox", { keyPath: "key" }); }
      if (!db.objectStoreNames.contains("meta")) { db.createObjectStore("meta", { keyPath: "key" }); }
    };
    req.onsuccess = () => resolve(new Store(req.result));
    req.onerror = () => reject(req.error);
  });
}

export class Store {
  constructor(db) { this.db = db; }

  #tx(names, mode) { return this.db.transaction(names, mode); }

  #done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  #all(storeName) {
    return new Promise((resolve, reject) => {
      const req = this.#tx([storeName], "readonly").objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  #get(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = this.#tx([storeName], "readonly").objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  routes() { return this.#all("routes"); }
  shops() { return this.#all("shops"); }
  entries() { return this.#all("entries"); }
  outbox() { return this.#all("outbox"); }

  async meta(key, fallback = null) {
    const row = await this.#get("meta", key);
    return row ? row.value : fallback;
  }

  async setMeta(key, value) {
    const tx = this.#tx(["meta"], "readwrite");
    tx.objectStore("meta").put({ key, value });
    await this.#done(tx);
  }

  /**
   * Write a change locally and queue it for the server, in one transaction.
   *
   * The two must not come apart. A record that reaches the screen but not the
   * outbox is a payment that silently never syncs — the exact failure that
   * would make him stop trusting the app.
   */
  async apply({ routes = [], shops = [], entries = [], reversals = [] }) {
    const tx = this.#tx(["routes", "shops", "entries", "outbox"], "readwrite");

    for (const r of routes) { tx.objectStore("routes").put(r); }
    for (const s of shops) { tx.objectStore("shops").put(s); }
    for (const e of entries) { tx.objectStore("entries").put(e); }

    for (const r of reversals) {
      const store = tx.objectStore("entries");
      const req = store.get(r.id);
      req.onsuccess = () => {
        const row = req.result;
        if (row && !row.reversed_by) { store.put({ ...row, reversed_by: r.reversed_by }); }
      };
    }

    const box = tx.objectStore("outbox");
    const queue = (kind, item, id) => box.put({ key: `${kind}:${id}`, kind, item, queued_at: Date.now() });
    for (const r of routes) { queue("route", r, r.id); }
    for (const s of shops) { queue("shop", s, s.id); }
    for (const e of entries) { queue("entry", e, e.id); }
    for (const r of reversals) { queue("reversal", r, r.id); }

    await this.#done(tx);
  }

  /** Merge what the server sent. Server rows always win: they are the agreed version. */
  async acceptFromServer({ routes = [], shops = [], entries = [] }, seq) {
    const tx = this.#tx(["routes", "shops", "entries", "meta"], "readwrite");
    for (const r of routes) { tx.objectStore("routes").put(r); }
    for (const s of shops) { tx.objectStore("shops").put(s); }
    for (const e of entries) { tx.objectStore("entries").put(e); }
    tx.objectStore("meta").put({ key: "since", value: seq });
    await this.#done(tx);
  }

  /** Drop the outbox rows the server confirmed. Anything else stays and is retried. */
  async clearOutbox(keys) {
    const tx = this.#tx(["outbox"], "readwrite");
    for (const k of keys) { tx.objectStore("outbox").delete(k); }
    await this.#done(tx);
  }

  /** Wipe local data on sign-out. The server keeps the ledger; the phone keeps nothing. */
  async clearAll() {
    const names = ["routes", "shops", "entries", "outbox", "meta"];
    const tx = this.#tx(names, "readwrite");
    for (const n of names) { tx.objectStore(n).clear(); }
    await this.#done(tx);
  }
}

/** Client-side ids, so an entry exists and is final before any network call. */
export function newId(prefix) {
  const rand = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(16).slice(2);
  return `${prefix}-${rand}`.slice(0, 40);
}

/** The business date from the device clock. Never typed, never edited. */
export function businessDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
