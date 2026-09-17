/**
 * Money and dates.
 *
 * Amounts are whole rupees as integers everywhere in this codebase. Floats and
 * money do not mix: 0.1 + 0.2 is not 0.3, and a forecast that adds ninety days
 * of floats together drifts by enough to change a RED into an AMBER. If paise
 * are ever needed, the change is to store paise as integers, not to reach for
 * a float.
 */

export function toRupees(value) {
  if (typeof value === "number") { return Math.round(value); }
  const cleaned = String(value ?? "").replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Indian digit grouping: 1840000 -> "18,40,000". */
export function group(n) {
  const neg = n < 0;
  const s = String(Math.abs(Math.round(n)));
  const grouped = s.length <= 3
    ? s
    : s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + s.slice(-3);
  return (neg ? "-" : "") + grouped;
}

export const rupees = (n) => "₹" + group(n);

/** Short form for chart axes and tiles: 1840000 -> "₹18.4L". */
export function rupeesShort(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) { return `${sign}₹${(abs / 10000000).toFixed(abs >= 100000000 ? 0 : 1)}Cr`; }
  if (abs >= 100000) { return `${sign}₹${(abs / 100000).toFixed(abs >= 1000000 ? 0 : 1)}L`; }
  if (abs >= 1000) { return `${sign}₹${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`; }
  return `${sign}₹${abs}`;
}

// ---- dates: always 'YYYY-MM-DD' strings, never Date objects in the model ----

export const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function today() {
  return toISO(new Date());
}

export function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromISO, toISOdate) {
  return Math.round((Date.parse(toISOdate + "T00:00:00Z") - Date.parse(fromISO + "T00:00:00Z")) / 86400000);
}

/**
 * Parse the date formats Indian accounting exports actually use.
 * DD-MM-YYYY and DD/MM/YYYY are the common ones from Tally and bank
 * statements; ISO turns up from anything modern. US MM/DD is deliberately
 * NOT guessed — 03/04/2026 is ambiguous, and silently reading it wrong would
 * put a payment in the wrong month and quietly change the forecast.
 */
export function parseDate(value) {
  const s = String(value ?? "").trim();
  if (!s) { return null; }
  if (ISO.test(s)) { return Number.isNaN(Date.parse(s + "T00:00:00Z")) ? null : s; }

  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) { year += 2000; }
    if (month < 1 || month > 12 || day < 1 || day > 31) { return null; }
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return Number.isNaN(Date.parse(iso + "T00:00:00Z")) ? null : iso;
  }

  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

export function dmy(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

export const median = (values) => {
  if (!values.length) { return 0; }
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
