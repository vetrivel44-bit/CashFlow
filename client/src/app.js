/**
 * The app.
 *
 * Every screen reads from the local store and never from the network. Writes go
 * to the local store first and are queued for the server afterwards, so tapping
 * Save always works, with or without signal, and nothing in here has a loading
 * state. That is not an optimisation — it is the whole reason a delivery man
 * standing in a dead zone can record a payment at all.
 */
import { openStore, newId, businessDate } from "./store.js";
import { Api, Sync } from "./sync.js";
import { t, group, rupees, dmy, LANGUAGES } from "./i18n.js";
import {
  balanceOf, daysOutstanding, collectedOn, deliveredOn,
  outstandingList, groupByShop
} from "../../shared/ledger.js";

const screen = document.getElementById("page");
const tabsEl = document.getElementById("tabs");
const printarea = document.getElementById("printarea");

const TOKEN_KEY = "cashflow.token";
const USER_KEY = "cashflow.user";
const LANG_KEY = "cashflow.lang";

const read = (k, fallback = null) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
const drop = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

let store = null;
let api = null;
let sync = null;

const ui = {
  lang: read(LANG_KEY, "en"),
  user: JSON.parse(read(USER_KEY, "null")),
  signin: { userId: null, users: [], pin: "", error: null },
  screen: "main",          // owner: main | shop | sheet | excel | remind
  tab: "record",           // staff: record | shops | day
  kind: "payment", when: "today", routeId: null, shopId: null, pad: "",
  filterRoute: "all", showArchived: false,
  form: null, formErr: null, note: null
};

let data = { routes: [], shops: [], entries: [], byShop: new Map() };

const L = () => ui.lang;
const S = (key) => t(L(), key);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const today = () => businessDate(0);
const shopById = (id) => data.shops.find((s) => s.id === id);
const routeName = (id) => data.routes.find((r) => r.id === id)?.name ?? "";
const entriesOf = (id) => data.byShop.get(id) ?? [];
const signalFor = (d) => (d === null ? "" : d > 21 ? "sig-overdue" : d >= 8 ? "sig-due" : "");
const isOwner = () => ui.user?.role === "owner";

async function refresh() {
  const [routes, shops, entries] = await Promise.all([store.routes(), store.shops(), store.entries()]);
  // IndexedDB returns rows in key order, which is meaningless here. Order by
  // the sequence they were created in: routes in the order the business set
  // them up, and shops within a route in delivery order rather than
  // alphabetically, because staff tap down the list in the order they visited.
  const bySeq = (a, b) => (a.seq ?? 0) - (b.seq ?? 0);
  data = {
    routes: routes.sort(bySeq),
    shops: shops.sort(bySeq),
    entries,
    byShop: groupByShop(entries)
  };
  if (!ui.routeId && data.routes.length) { ui.routeId = data.routes[0].id; }
}

/** Write locally, show it immediately, and let sync deliver it when it can. */
async function commit(change) {
  await store.apply(change);
  await refresh();
  render();
  sync?.nudge();
}

// ---------------------------------------------------------------- sign in ---

async function renderSignIn() {
  tabsEl.innerHTML = "";
  const { users, userId, pin, error } = ui.signin;

  if (!userId) {
    screen.innerHTML =
      `<div class="signin"><h1>${esc(S("brand"))}</h1>` +
      `<div class="flabel label14">${esc(S("signIn"))}</div>` +
      `<div class="cardlist">` +
      users.map((u) => `<button type="button" class="crow" data-pick="${u.id}">
          <span class="left">${esc(u.name)}<span class="sub2">${u.role === "owner" ? "Owner" : "Staff"}</span></span>
          <span class="chev">›</span></button>`).join("") +
      `</div>${langBar()}</div>`;
    return;
  }

  const name = users.find((u) => u.id === userId)?.name ?? "";
  const keys = ["1","2","3","4","5","6","7","8","9"]
    .map((k) => `<button type="button" class="key pad-digit" data-pin="${k}">${k}</button>`).join("");

  screen.innerHTML =
    `<div class="signin">` +
    `<div class="navbar"><button type="button" class="navback" data-pinback="1">← ${esc(S("back"))}</button>
       <span class="navtitle">${esc(name)}</span></div>` +
    (error ? `<div class="warn">${esc(error)}</div>` : "") +
    `<div class="flabel label14" style="text-align:center">${esc(S("enterPin"))}</div>` +
    `<div class="pindots">${[0,1,2,3,4,5].map((i) => `<i class="${i < pin.length ? "on" : ""}"></i>`).join("")}</div>` +
    `<div class="keys">${keys}
       <button type="button" class="key back" data-pin="clear">✕</button>
       <button type="button" class="key pad-digit" data-pin="0">0</button>
       <button type="button" class="key back" data-pin="del">${esc(S("del"))}</button></div>
     <div class="kbdhint">${esc(S("kbdPin"))}</div>` +
    `</div>`;
}

async function trySignIn() {
  const { userId, pin } = ui.signin;
  try {
    const res = await api.login(userId, pin, navigator.userAgent.slice(0, 60));
    write(TOKEN_KEY, res.token);
    write(USER_KEY, JSON.stringify(res.user));
    ui.user = res.user;
    ui.signin = { userId: null, users: [], pin: "", error: null };
    await startSession();
  } catch (err) {
    ui.signin.pin = "";
    ui.signin.error = err.message || S("wrongPin");
    renderSignIn();
  }
}

function signOut() {
  api?.call("POST", "/api/auth/logout").catch(() => {});
  sync?.stop();
  drop(TOKEN_KEY); drop(USER_KEY);
  ui.user = null;
  // The ledger stays on the server. A signed-out phone keeps nothing.
  store?.clearAll().then(boot);
}

// ------------------------------------------------------------------- bits ---

function langBar() {
  return `<div class="lang" role="group" aria-label="Language">` +
    LANGUAGES.map((l) => `<button type="button" data-lang="${l.code}" aria-pressed="${ui.lang === l.code}">${esc(l.endonym)}</button>`).join("") +
    `</div>`;
}

const navbar = (title) =>
  `<div class="navbar"><button type="button" class="navback" data-act="home">← ${esc(S("back"))}</button>
     <span class="navtitle">${esc(title)}</span></div>`;

const kindLabel = (k) => (k === "payment" ? S("payment") : k === "opening" ? S("opening") : S("delivery"));

function outstandingRows() {
  return outstandingList(data.shops, data.byShop, today());
}

function sheetHtml() {
  const rows = outstandingRows();
  const total = rows.reduce((s, r) => s + r.balance, 0);
  return `<div class="sheet">
    <div class="shead"><div class="stitle">${esc(S("sheetTitle"))}</div><div>${dmy(today())}</div></div>
    <table><thead><tr><th>${esc(S("colShop"))}</th><th class="n">${esc(S("colDays"))}</th><th class="n">${esc(S("colAmount"))}</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.shop.name)}</td><td class="n">${r.days}</td><td class="n">${group(r.balance)}</td></tr>`).join("")}
    <tr class="total"><td>${esc(S("totalRow")(rows.length))}</td><td class="n"></td><td class="n">${group(total)}</td></tr>
    </tbody></table>
    <div class="sfoot"><span>${esc(S("collectedToday"))} ${rupees(collectedOn(data.entries, today()))}</span><span>${esc(S("page"))}</span></div>
  </div>`;
}

function ledgerHtml(shopId, withUndo) {
  const rows = entriesOf(shopId).slice().sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : a.seq - b.seq));
  if (!rows.length) { return `<div class="empty">${esc(S("noEntries"))}</div>`; }
  let run = 0;
  return rows.map((e) => {
    // Same rule as the server: neither half of a correction is money.
    if (!e.reversed_by && !e.reversal_of) { run += e.kind === "payment" ? -e.amount : e.amount; }
    const tag = e.reversed_by ? `<span class="tag">${esc(S("reversedTag"))}</span>`
              : e.reversal_of ? `<span class="tag">${esc(S("reversalTag"))}</span>` : "";
    const canUndo = withUndo && !e.reversed_by && !e.reversal_of && e.entry_date === today();
    const debit = e.kind !== "payment";
    return `<div class="led${e.reversed_by ? " reversed" : ""}">
      <div class="lmain"><div>${esc(kindLabel(e.kind))}</div>
        <div class="lsub">${dmy(e.entry_date)} · ${esc(S("runningBal"))} ${group(run)} ${tag}</div></div>
      <div class="lamt ${debit ? "plus" : "minus"}">${debit ? "+" : "−"} ${group(e.amount)}</div>
      ${canUndo ? `<button type="button" class="undo" data-undo="${e.id}">${esc(S("undo"))}</button>` : ""}
    </div>`;
  }).reverse().join("");
}

// ------------------------------------------------------------------ owner ---

function renderOwner() {
  tabsEl.innerHTML = "";
  const rows = outstandingRows();

  if (ui.screen === "shop") {
    const s = shopById(ui.shopId);
    const es = entriesOf(s.id);
    const d = daysOutstanding(es, today());
    screen.innerHTML = navbar(s.name) +
      `<div class="band"><div class="cell">
         <div class="owner-meta lab">${esc(S("balanceNow"))}</div>
         <div class="owner-total val">${rupees(balanceOf(es))}</div>
         <div class="owner-meta sub">${d === null ? "—" : esc(S("oldestUnpaid")) + " · " + esc(S("days")(d))}</div>
       </div></div>
       <div class="sechead">${esc(S("history"))}</div>` + ledgerHtml(s.id, false);
    return;
  }

  if (ui.screen === "sheet") {
    printarea.innerHTML = sheetHtml();
    screen.innerHTML = navbar(S("printTitle")) + sheetHtml() +
      `<div class="field"><div class="hintline">${esc(S("printSub"))}</div></div>
       <div class="stack"><button type="button" class="btn primary" data-act="doprint">${esc(S("printNow"))}</button></div>`;
    return;
  }

  if (ui.screen === "excel") {
    screen.innerHTML = navbar(S("excelTitle")) +
      `<div class="band">` +
      rows.slice(0, 6).map((r) => `<div class="kv"><span class="k">${esc(r.shop.name)}</span><span class="v">${group(r.balance)}</span></div>`).join("") +
      (rows.length > 6 ? `<div class="kv"><span class="k">…</span><span class="v">${esc(S("shopsCount")(rows.length))}</span></div>` : "") +
      `</div>
       <div class="field" style="margin-top:var(--space-4)"><div class="hintline">${esc(S("excelSub"))}</div></div>` +
      (ui.note ? `<div class="flash">${esc(ui.note)}</div>` : "") +
      `<div class="stack"><button type="button" class="btn primary" data-act="download">${esc(S("saveFile"))}</button></div>`;
    return;
  }

  if (ui.screen === "remind") {
    const pick = ui.shopId ? rows.find((r) => r.shop.id === ui.shopId) : null;
    if (!pick) {
      screen.innerHTML = navbar(S("reminderTitle")) +
        `<div class="flabel label14">${esc(S("pickShop"))}</div><div class="cardlist">` +
        rows.slice(0, 10).map((r) => `<button type="button" class="crow" data-act="pickremind" data-shop="${r.shop.id}">
            <span class="left">${esc(r.shop.name)}<span class="sub2">${esc(S("days")(r.days))}${r.shop.phone ? "" : " · " + esc(S("noPhone"))}</span></span>
            <span class="bal out">${group(r.balance)}</span></button>`).join("") +
        `</div>`;
      return;
    }
    const msg = S("reminderMsg")(pick.shop.name, rupees(pick.balance), S("days")(pick.days));
    const last = pick.shop.reminded_on ? S("sentAlready")(dmy(pick.shop.reminded_on)) : S("neverReminded");
    screen.innerHTML = navbar(S("reminderTitle")) +
      `<div class="flabel label14">${esc(S("reminderFor"))} · ${esc(pick.shop.name)}</div>
       <div class="band"><div style="font-size:16px;line-height:25px">${esc(msg)}</div></div>
       <div class="field" style="margin-top:var(--space-3)"><div class="hintline">${esc(last)}${pick.shop.phone ? " · " + esc(pick.shop.phone) : ""}</div></div>
       <div class="stack">
         <button type="button" class="btn go" data-act="sendwa" data-shop="${pick.shop.id}"${pick.shop.phone ? "" : " disabled"}>${esc(S("sendWhatsapp"))}</button>
         <button type="button" class="btn" data-act="home">${esc(S("cancel"))}</button>
       </div>`;
    return;
  }

  const items = rows.map((r, i) => {
    const worst = r.days !== null && r.days > 21;
    return `<button type="button" class="row ${signalFor(r.days)}${worst ? " worst" : i % 2 ? " alt" : ""}" data-act="openshop" data-shop="${r.shop.id}">
      <span class="who"><span class="owner-shop shop">${esc(r.shop.name)}</span>
        <span class="meta"><span class="d">${esc(S("days")(r.days))}</span> · ${esc(routeName(r.shop.route_id))}</span></span>
      <span class="owner-amount amt">${group(r.balance)}</span></button>`;
  }).join("");

  const total = rows.reduce((s, r) => s + r.balance, 0);
  const d = new Date();
  screen.innerHTML =
    `<div class="apphead"><span class="who"><span class="brand">${esc(S("brand"))}</span>
       <span class="date" style="display:block">${dmy(today())} · ${S("weekday")[d.getDay()]}</span></span>${langBar()}</div>
     <div class="band split">
       <div class="cell"><div class="owner-meta lab">${esc(S("collectedToday"))}</div>
         <div class="owner-total val paid">${rupees(collectedOn(data.entries, today()))}</div></div>
       <div class="cell"><div class="owner-meta lab">${esc(S("totalOutstanding"))}</div>
         <div class="owner-total val">${rupees(total)}</div>
         <div class="owner-meta sub">${esc(S("shopCount")(rows.length))}</div></div>
     </div>
     <div class="actions">
       <button type="button" class="act remind" data-act="remind">${esc(S("sendReminder"))}</button>
       <button type="button" class="act" data-act="print">${esc(S("print"))}</button>
       <button type="button" class="act" data-act="excel">${esc(S("excel"))}</button></div>
     <div class="listhead"><span class="owner-meta">${esc(S("longestOutstanding"))}</span><span class="hint">${esc(S("tapHint"))}</span></div>
     <div class="list">${items || `<div class="empty" style="padding:var(--space-4)">—</div>`}</div>
     <div class="stack"><button type="button" class="btn" data-act="signout">${esc(S("signOut"))}</button></div>`;
}

// ------------------------------------------------------------------ staff ---

function renderTabs() {
  tabsEl.innerHTML = [["record", S("tabRecord")], ["shops", S("tabShops")], ["day", S("tabDay")]]
    .map(([id, label]) => `<button type="button" class="tab" data-tab="${id}" aria-pressed="${ui.tab === id}">${esc(label)}</button>`)
    .join("");
}

function renderStaff() {
  renderTabs();

  if (ui.screen === "pad") {
    const s = shopById(ui.shopId);
    const value = ui.pad === "" ? 0 : parseInt(ui.pad, 10);
    const keys = ["1","2","3","4","5","6","7","8","9"]
      .map((k) => `<button type="button" class="key pad-digit" data-key="${k}">${k}</button>`).join("");
    screen.innerHTML = navbar(s.name) +
      `<div class="flabel label14">${esc(kindLabel(ui.kind))} · ${esc(ui.when === "today" ? S("today") : S("yesterday"))}</div>
       <div class="readout owner-total">${rupees(value)}</div>
       <div class="keys">${keys}
         <button type="button" class="key quick" data-key="+500">+500</button>
         <button type="button" class="key pad-digit" data-key="0">0</button>
         <button type="button" class="key back" data-key="del">${esc(S("del"))}</button></div>
       <button type="button" class="confirm" data-act="confirm"${value > 0 ? "" : " disabled"}>${esc(S("save"))}</button>
       <div class="kbdhint">${esc(S("kbdPad"))}</div>`;
    return;
  }

  if (ui.screen === "shopform") {
    const f = ui.form;
    const dup = f.name && !f.id && data.shops.some((x) => norm(x.name) === norm(f.name));
    screen.innerHTML = navbar(f.id ? S("editShop") : S("newShop")) +
      (ui.formErr ? `<div class="warn">${esc(ui.formErr)}</div>` : "") +
      (dup ? `<div class="warn">${esc(S("dupWarn")(f.name))}</div>` : "") +
      `<div class="field"><label for="f-name">${esc(S("fName"))}</label>
        <input id="f-name" type="text" autocomplete="off" autocapitalize="words" spellcheck="false" value="${esc(f.name)}">
        <div class="hintline">${esc(S("fNameHint"))}</div></div>
       <div class="field"><label for="f-phone">${esc(S("fPhone"))}</label>
        <input id="f-phone" type="tel" inputmode="numeric" maxlength="10" value="${esc(f.phone)}">
        <div class="hintline">${esc(S("fPhoneHint"))}</div></div>
       <div class="field"><label>${esc(S("fRoute"))}</label><div class="chips">` +
        data.routes.map((r) => `<button type="button" class="chip" data-formroute="${r.id}" aria-pressed="${f.routeId === r.id}">${esc(r.name)}</button>`).join("") +
        `<button type="button" class="chip ghost" data-act="newroute">+ ${esc(S("addRoute"))}</button></div></div>` +
      (f.id ? "" :
        `<div class="field"><label for="f-open">${esc(S("fOpening"))}</label>
          <input id="f-open" type="text" inputmode="numeric" value="${esc(f.opening)}">
          <div class="hintline">${esc(S("fOpeningHint"))}</div></div>`) +
      `<div class="stack"><button type="button" class="btn primary" data-act="saveshop">${esc(S("save"))}</button>` +
      (f.id ? `<button type="button" class="btn" data-act="archive" data-shop="${f.id}">${esc(S("archive"))}</button>
               <div class="hintline">${esc(S("archiveNote"))}</div>` : "") + `</div>`;
    return;
  }

  if (ui.screen === "shopdetail") {
    const s = shopById(ui.shopId);
    const es = entriesOf(s.id);
    const d = daysOutstanding(es, today());
    screen.innerHTML = navbar(s.name) +
      (ui.note ? `<div class="flash">${esc(ui.note)}</div>` : "") +
      `<div class="band">
        <div class="kv"><span class="k">${esc(S("balanceNow"))}</span><span class="v">${rupees(balanceOf(es))}</span></div>
        <div class="kv"><span class="k">${esc(S("oldestUnpaid"))}</span><span class="v">${d === null ? "—" : esc(S("days")(d))}</span></div>
        <div class="kv"><span class="k">${esc(S("fRoute"))}</span><span class="v">${esc(routeName(s.route_id))}</span></div>
        <div class="kv"><span class="k">${esc(S("phone"))}</span><span class="v">${s.phone ? esc(s.phone) : esc(S("noPhone"))}</span></div>
      </div>
      <div class="stack" style="margin-top:var(--space-4)">
        <button type="button" class="btn" data-act="editshop" data-shop="${s.id}">${esc(S("editShop"))}</button>` +
        (s.archived ? `<button type="button" class="btn" data-act="unarchive" data-shop="${s.id}">${esc(S("unarchive"))}</button>` : "") +
      `</div><div class="sechead">${esc(S("history"))}</div>` + ledgerHtml(s.id, true);
    return;
  }

  if (ui.tab === "shops") {
    const listed = data.shops.filter((x) =>
      Boolean(x.archived) === ui.showArchived && (ui.filterRoute === "all" || x.route_id === ui.filterRoute));
    screen.innerHTML =
      `<div class="apphead"><span class="who"><span class="brand">${esc(S("tabShops"))}</span>
         <span class="date" style="display:block">${esc(S("shopsCount")(listed.length))}</span></span>${langBar()}</div>` +
      (ui.note ? `<div class="flash">${esc(ui.note)}</div>` : "") +
      `<div class="stack" style="margin-top:0;margin-bottom:var(--space-4)">
         <button type="button" class="btn primary" data-act="newshop">+ ${esc(S("addShop"))}</button></div>
       <div class="chips">
         <button type="button" class="chip" data-filter="all" aria-pressed="${ui.filterRoute === "all"}">${esc(S("allRoutes"))}</button>` +
        data.routes.map((r) => `<button type="button" class="chip" data-filter="${r.id}" aria-pressed="${ui.filterRoute === r.id}">${esc(r.name)}</button>`).join("") +
      `</div><div class="cardlist">` +
      (listed.length ? listed.map((x) => {
        const b = balanceOf(entriesOf(x.id));
        return `<button type="button" class="crow" data-act="opendetail" data-shop="${x.id}">
          <span class="left">${esc(x.name)}<span class="sub2">${esc(routeName(x.route_id))}${x.phone ? "" : " · " + esc(S("noPhone"))}</span></span>
          <span class="bal ${b > 0 ? "out" : "zero"}">${group(b)}</span><span class="chev">›</span></button>`;
      }).join("") : `<div class="empty" style="padding:var(--space-4)">—</div>`) +
      `</div><div class="stack">
         <button type="button" class="btn" data-act="togglearch">${esc(ui.showArchived ? S("tabShops") : S("archived"))}</button>
         <button type="button" class="btn" data-act="signout">${esc(S("signOut"))}</button></div>`;
    return;
  }

  if (ui.tab === "day") {
    const ofDay = data.entries.filter((e) => e.entry_date === today());
    const paymentCount = ofDay.filter((e) => e.kind === "payment" && !e.reversed_by && !e.reversal_of).length;
    screen.innerHTML =
      `<div class="apphead"><span class="who"><span class="brand">${esc(S("dayTitle"))}</span>
         <span class="date" style="display:block">${dmy(today())}</span></span>${langBar()}</div>
       <div class="band split">
         <div class="cell"><div class="owner-meta lab">${esc(S("dayCollected"))}</div>
           <div class="owner-total val paid">${rupees(collectedOn(data.entries, today()))}</div>
           <div class="owner-meta sub">${esc(S("dayCount")(paymentCount))} · ${esc(S("dayHandover"))}</div></div>
         <div class="cell"><div class="owner-meta lab">${esc(S("dayDelivered"))}</div>
           <div class="owner-total val">${rupees(deliveredOn(data.entries, today()))}</div></div>
       </div>
       <div class="sechead">${esc(S("todayEntries"))}</div>` +
      (ofDay.length ? ofDay.slice().sort((a, b) => b.seq - a.seq || 0).map((e) => {
        const s = shopById(e.shop_id);
        const tag = e.reversed_by ? `<span class="tag">${esc(S("reversedTag"))}</span>`
                  : e.reversal_of ? `<span class="tag">${esc(S("reversalTag"))}</span>` : "";
        const debit = e.kind !== "payment";
        const canUndo = !e.reversed_by && !e.reversal_of;
        return `<div class="led${e.reversed_by ? " reversed" : ""}">
          <div class="lmain"><div>${esc(s?.name ?? "")}</div><div class="lsub">${esc(kindLabel(e.kind))} ${tag}</div></div>
          <div class="lamt ${debit ? "plus" : "minus"}">${debit ? "+" : "−"} ${group(e.amount)}</div>
          ${canUndo ? `<button type="button" class="undo" data-undo="${e.id}">${esc(S("undo"))}</button>` : ""}</div>`;
      }).join("") : `<div class="empty">${esc(S("noEntries"))}</div>`);
    return;
  }

  const inRoute = data.shops.filter((x) => !x.archived && x.route_id === ui.routeId);
  screen.innerHTML =
    `<div class="apphead"><span class="who"><span class="brand">${esc(S("tabRecord"))}</span>
       <span class="date" style="display:block">${dmy(today())}</span></span>${langBar()}</div>` +
    (ui.note ? `<div class="flash">${esc(ui.note)}</div>` : "") +
    `<div class="flabel label14">${esc(S("entryKind"))}</div>
     <div class="seg">
       <button type="button" data-kind="payment" aria-pressed="${ui.kind === "payment"}">${esc(S("payment"))}</button>
       <button type="button" data-kind="delivery" aria-pressed="${ui.kind === "delivery"}">${esc(S("delivery"))}</button></div>
     <div class="flabel label14">${esc(S("whichDay"))}</div>
     <div class="seg">
       <button type="button" data-when="today" aria-pressed="${ui.when === "today"}">${esc(S("today"))}</button>
       <button type="button" data-when="yesterday" aria-pressed="${ui.when === "yesterday"}">${esc(S("yesterday"))}</button></div>
     <div class="flabel label14">${esc(S("route"))}</div>
     <div class="chips">` +
      data.routes.map((r) => `<button type="button" class="chip" data-route="${r.id}" aria-pressed="${ui.routeId === r.id}">${esc(r.name)}</button>`).join("") +
    `</div><div class="flabel label14">${esc(S("shop"))}</div><div class="cardlist">` +
    (inRoute.length ? inRoute.map((x) => {
      const b = balanceOf(entriesOf(x.id));
      const d = daysOutstanding(entriesOf(x.id), today());
      return `<button type="button" class="crow" data-shop="${x.id}"><span class="left">${esc(x.name)}</span>
        <span class="bal ${b > 0 ? (d !== null && d > 21 ? "out" : "") : "zero"}">${group(b)}</span></button>`;
    }).join("") : `<div class="empty" style="padding:var(--space-4)">—</div>`) +
    `</div>`;
}

const norm = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, "");

function render() {
  if (!ui.user) { renderSignIn(); return; }
  if (isOwner()) { renderOwner(); } else { renderStaff(); }
  printarea.innerHTML = sheetHtml();
}

// ----------------------------------------------------------------- events ---

function readForm() {
  if (!ui.form) { return; }
  const n = document.getElementById("f-name");
  const p = document.getElementById("f-phone");
  const o = document.getElementById("f-open");
  if (n) { ui.form.name = n.value; }
  if (p) { ui.form.phone = p.value.replace(/\D/g, "").slice(0, 10); }
  if (o) { ui.form.opening = o.value.replace(/\D/g, ""); }
}

async function downloadExport() {
  ui.note = S("downloading");
  render();
  try {
    const res = await fetch("/api/export.xlsx", { headers: { authorization: "Bearer " + read(TOKEN_KEY, "") } });
    if (!res.ok) { throw new Error("failed"); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outstanding-${today()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    ui.note = S("downloaded");
  } catch {
    // The export is built on the server, so it is the one thing here that
    // needs signal. Say so plainly rather than failing silently.
    ui.note = S("offline");
  }
  render();
}

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button");
  if (!el) { return; }

  const lang = el.dataset.lang;
  if (lang) { readForm(); ui.lang = lang; write(LANG_KEY, lang); render(); return; }

  // sign in
  if (el.dataset.pick) { ui.signin.userId = el.dataset.pick; ui.signin.pin = ""; renderSignIn(); return; }
  if (el.dataset.pinback) { ui.signin.userId = null; ui.signin.error = null; renderSignIn(); return; }
  if (el.dataset.pin) {
    const k = el.dataset.pin;
    if (k === "del") { ui.signin.pin = ui.signin.pin.slice(0, -1); }
    else if (k === "clear") { ui.signin.pin = ""; }
    else if (ui.signin.pin.length < 6) { ui.signin.pin += k; }
    ui.signin.error = null;
    renderSignIn();
    if (ui.signin.pin.length === 4) { await trySignIn(); }
    return;
  }

  const act = el.dataset.act;
  if (act === "signout") { signOut(); return; }

  if (isOwner()) {
    switch (act) {
      case "openshop": ui.shopId = el.dataset.shop; ui.screen = "shop"; break;
      case "remind": ui.screen = "remind"; ui.shopId = null; break;
      case "pickremind": ui.shopId = el.dataset.shop; break;
      case "print": ui.screen = "sheet"; break;
      case "excel": ui.screen = "excel"; ui.note = null; break;
      case "home": ui.screen = "main"; ui.shopId = null; ui.note = null; break;
      case "doprint": window.print(); return;
      case "download": await downloadExport(); return;
      case "sendwa": {
        const shop = shopById(el.dataset.shop);
        const row = outstandingRows().find((r) => r.shop.id === shop.id);
        const msg = S("reminderMsg")(shop.name, rupees(row.balance), S("days")(row.days));
        // The reminder is the shop's record changing, so it syncs like anything else.
        await commit({ shops: [{ ...shop, reminded_on: today(), updated_at: Date.now() }] });
        window.open(`https://wa.me/91${shop.phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
        ui.screen = "main"; ui.shopId = null;
        break;
      }
      default: return;
    }
    render();
    return;
  }

  // staff
  const d = el.dataset;
  if (d.tab) { ui.tab = d.tab; ui.screen = d.tab; ui.note = null; ui.form = null; render(); return; }
  if (d.kind) { ui.kind = d.kind; render(); return; }
  if (d.when) { ui.when = d.when; render(); return; }
  if (d.route) { ui.routeId = d.route; render(); return; }
  if (d.filter) { ui.filterRoute = d.filter; render(); return; }
  if (d.formroute) { readForm(); ui.form.routeId = d.formroute; render(); return; }

  if (d.key) {
    if (d.key === "del") { ui.pad = ui.pad.slice(0, -1); }
    else if (d.key === "+500") { ui.pad = String((ui.pad === "" ? 0 : parseInt(ui.pad, 10)) + 500); }
    else if (ui.pad.length < 7) { ui.pad += d.key; }
    render();
    return;
  }

  if (d.undo) {
    const orig = data.entries.find((e) => e.id === d.undo);
    if (orig) {
      // A correction is two rows and neither counts as money. Both stay
      // visible for ever; nothing is deleted.
      const fix = {
        id: newId("e"), shop_id: orig.shop_id,
        kind: orig.kind === "payment" ? "delivery" : "payment",
        amount: orig.amount, entry_date: today(),
        reversed_by: null, reversal_of: orig.id, created_at: Date.now(), seq: Date.now()
      };
      await commit({ entries: [fix], reversals: [{ id: orig.id, reversed_by: fix.id }] });
      ui.note = S("undone")(shopById(orig.shop_id)?.name ?? "");
      render();
    }
    return;
  }

  if (d.shop && !act) { ui.shopId = d.shop; ui.pad = ""; ui.note = null; ui.screen = "pad"; render(); return; }

  switch (act) {
    case "home": ui.screen = ui.tab; ui.form = null; ui.formErr = null; render(); return;

    case "confirm": {
      const amount = ui.pad === "" ? 0 : parseInt(ui.pad, 10);
      if (amount <= 0) { return; }
      const shop = shopById(ui.shopId);
      const entry = {
        id: newId("e"), shop_id: shop.id, kind: ui.kind, amount,
        entry_date: businessDate(ui.when === "today" ? 0 : 1),
        reversed_by: null, reversal_of: null, created_at: Date.now(), seq: Date.now()
      };
      await commit({ entries: [entry] });
      ui.note = S("recorded")(kindLabel(ui.kind), rupees(amount), shop.name);
      ui.pad = ""; ui.screen = "record"; ui.tab = "record";
      render();
      return;
    }

    case "newshop":
      ui.form = { id: null, name: "", phone: "", routeId: data.routes[0]?.id ?? null, opening: "" };
      ui.formErr = null; ui.screen = "shopform"; render(); return;

    case "editshop": {
      const s = shopById(el.dataset.shop);
      ui.form = { id: s.id, name: s.name, phone: s.phone, routeId: s.route_id, opening: "" };
      ui.formErr = null; ui.screen = "shopform"; render(); return;
    }

    case "newroute": {
      readForm();
      const route = { id: newId("r"), name: `${S("routeName")} ${data.routes.length + 1}`, updated_at: Date.now() };
      await commit({ routes: [route] });
      ui.form.routeId = route.id;
      render();
      return;
    }

    case "saveshop": {
      readForm();
      const f = ui.form;
      if (!f.name.trim()) { ui.formErr = S("needName"); render(); return; }
      if (f.phone && f.phone.length !== 10) { ui.formErr = S("needPhone"); render(); return; }
      ui.formErr = null;

      if (f.id) {
        const existing = shopById(f.id);
        const shop = { ...existing, name: f.name.trim(), phone: f.phone, route_id: f.routeId, updated_at: Date.now() };
        await commit({ shops: [shop] });
        ui.note = S("shopUpdated")(shop.name);
      } else {
        const shop = {
          id: newId("s"), name: f.name.trim(), phone: f.phone, route_id: f.routeId,
          archived: 0, reminded_on: null, updated_at: Date.now()
        };
        const opening = parseInt(f.opening || "0", 10);
        const entries = opening > 0 ? [{
          id: newId("e"), shop_id: shop.id, kind: "opening", amount: opening,
          entry_date: today(), reversed_by: null, reversal_of: null, created_at: Date.now(), seq: Date.now()
        }] : [];
        await commit({ shops: [shop], entries });
        ui.note = S("shopSaved")(shop.name);
      }
      ui.form = null; ui.screen = "shops"; ui.tab = "shops"; render();
      return;
    }

    case "archive": {
      const s = shopById(el.dataset.shop);
      await commit({ shops: [{ ...s, archived: 1, updated_at: Date.now() }] });
      ui.note = S("shopArchived")(s.name);
      ui.form = null; ui.screen = "shops"; ui.tab = "shops"; render();
      return;
    }

    case "unarchive": {
      const s = shopById(el.dataset.shop);
      await commit({ shops: [{ ...s, archived: 0, updated_at: Date.now() }] });
      ui.note = S("shopUpdated")(s.name);
      ui.screen = "shops"; ui.tab = "shops"; render();
      return;
    }

    case "togglearch": ui.showArchived = !ui.showArchived; ui.note = null; render(); return;
    case "opendetail": ui.shopId = el.dataset.shop; ui.note = null; ui.screen = "shopdetail"; render(); return;
  }
});

/**
 * Keyboard, for the laptop.
 *
 * It never replaces a tap target — every one of these has a button on screen,
 * because the phone is still the main way in. It exists because entering a
 * few hundred shops from the notebook with a mouse would be miserable, and
 * because a staff member at a desk expects Enter to mean Enter.
 */
document.addEventListener("keydown", (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) { return; }
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "");
  const digit = /^[0-9]$/.test(ev.key);

  // sign in
  if (!ui.user && ui.signin.userId) {
    if (digit && ui.signin.pin.length < 6) { ui.signin.pin += ev.key; ui.signin.error = null; renderSignIn(); if (ui.signin.pin.length === 4) { trySignIn(); } ev.preventDefault(); return; }
    if (ev.key === "Backspace") { ui.signin.pin = ui.signin.pin.slice(0, -1); renderSignIn(); ev.preventDefault(); return; }
    if (ev.key === "Enter" && ui.signin.pin.length >= 4) { trySignIn(); ev.preventDefault(); return; }
    if (ev.key === "Escape") { ui.signin.userId = null; ui.signin.error = null; renderSignIn(); return; }
    return;
  }
  if (!ui.user) { return; }

  // the amount pad
  if (!isOwner() && ui.screen === "pad" && !typing) {
    if (digit && ui.pad.length < 7) { ui.pad += ev.key; render(); ev.preventDefault(); return; }
    if (ev.key === "Backspace") { ui.pad = ui.pad.slice(0, -1); render(); ev.preventDefault(); return; }
    if (ev.key === "Enter") { document.querySelector('[data-act="confirm"]:not([disabled])')?.click(); ev.preventDefault(); return; }
  }

  // Enter saves a form the way a desk user expects
  if (ev.key === "Enter" && typing && ui.screen === "shopform") {
    document.querySelector('[data-act="saveshop"]')?.click();
    ev.preventDefault();
    return;
  }

  if (ev.key === "Escape" && !typing) {
    document.querySelector('[data-act="home"]')?.click();
  }
});

// ------------------------------------------------------------------- boot ---

async function startSession() {
  store = await openStore();
  sync = new Sync(store, api, {
    onChange: async () => { await refresh(); render(); },
    onSignedOut: () => { drop(TOKEN_KEY); drop(USER_KEY); ui.user = null; render(); }
  });
  await refresh();
  render();          // paint from the local copy first — never wait on the network
  sync.start();
}

async function boot() {
  // Same-origin: the app is served by the server that holds the ledger, so
  // there is no base URL to configure and nothing to get wrong in deployment.
  api = new Api("", () => read(TOKEN_KEY, ""));
  if (read(TOKEN_KEY)) { await startSession(); return; }
  try {
    ui.signin.users = (await api.users()).users;
  } catch {
    ui.signin.users = [];
    ui.signin.error = "Cannot reach the server. Sign in once while there is signal.";
  }
  renderSignIn();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => { /* http, or not supported */ });
}

boot();
