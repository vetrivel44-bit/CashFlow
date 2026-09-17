/**
 * Nightly backup to the owner's own Google Drive.
 *
 * The point of this file is what it does NOT do: the backup never passes
 * through our server, and our server never holds a Google credential. The
 * owner signs in to Google on his own phone, the token stays in that phone's
 * memory, and the file is uploaded straight from there to his Drive.
 *
 * That is the whole answer to "if the software collapses, where is my data?"
 * — it is in his Drive, in his account, in a format that opens without us.
 * If this project disappears tomorrow, he still has his accounts.
 *
 * Scope: drive.file. It grants access only to files this app itself created,
 * so connecting the backup cannot read anything else in his Drive. Ask for
 * less than you need and the backup fails; ask for more and you are asking a
 * suspicious man to trust you with his photographs.
 */

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "CashFlow Ledger backups";

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

/** Load Google Identity Services once. */
export function loadGis() {
  if (document.getElementById("gis-script")) { return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.id = "gis-script";
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not reach Google. Try again when there is signal."));
    document.head.appendChild(s);
  });
}

export async function connectDrive(clientId) {
  await loadGis();
  return new Promise((resolve, reject) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (res) => {
        if (res.error) { reject(new Error(res.error)); return; }
        accessToken = res.access_token;
        tokenExpiry = Date.now() + (res.expires_in ?? 3000) * 1000;
        resolve(true);
      }
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

function haveToken() { return accessToken && Date.now() < tokenExpiry - 60_000; }

async function ensureToken() {
  if (haveToken()) { return accessToken; }
  if (!tokenClient) { throw new Error("not_connected"); }
  return new Promise((resolve, reject) => {
    tokenClient.callback = (res) => {
      if (res.error) { reject(new Error(res.error)); return; }
      accessToken = res.access_token;
      tokenExpiry = Date.now() + (res.expires_in ?? 3000) * 1000;
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

async function driveFetch(path, options) {
  const token = await ensureToken();
  const res = await fetch("https://www.googleapis.com/drive/v3" + path, {
    ...options,
    headers: { authorization: "Bearer " + token, ...(options?.headers ?? {}) }
  });
  if (!res.ok) { throw new Error("drive_" + res.status); }
  return res.json();
}

async function folderId() {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const found = await driveFetch(`/files?q=${q}&fields=files(id)`, { method: "GET" });
  if (found.files?.length) { return found.files[0].id; }

  const made = await driveFetch("/files?fields=id", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
  });
  return made.id;
}

/**
 * Upload one file. Always a new file, never an overwrite — a backup that
 * replaces yesterday's is one bad night away from being no backup at all.
 */
export async function uploadBackup({ name, mimeType, body }) {
  const token = await ensureToken();
  const parent = await folderId();
  const boundary = "cashflow" + Math.random().toString(16).slice(2);

  const metadata = JSON.stringify({ name, parents: [parent] });
  const payload = typeof body === "string" ? body : JSON.stringify(body);

  const multipart =
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n${payload}\r\n` +
    `--${boundary}--`;

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": `multipart/related; boundary=${boundary}` },
    body: multipart
  });
  if (!res.ok) { throw new Error("upload_failed_" + res.status); }
  return res.json();
}

/**
 * Back up the whole ledger, as plain JSON, named by date.
 *
 * Call it when the owner's phone next has signal after the day closes. Failing
 * is fine and is not shown to him: the printed sheet is the backup he actually
 * relies on, and this one catches up tomorrow.
 */
export async function backupNow(api, { onDone = () => {}, onFail = () => {} } = {}) {
  try {
    const ledger = await api.backup();
    const date = new Date().toISOString().slice(0, 10);
    const file = await uploadBackup({
      name: `cashflow-${date}.json`,
      mimeType: "application/json",
      body: JSON.stringify(ledger, null, 2)
    });
    localStorage.setItem("cashflow.lastBackup", date);
    onDone(file);
    return file;
  } catch (err) {
    onFail(err);
    return null;
  }
}

export function lastBackupDate() {
  try { return localStorage.getItem("cashflow.lastBackup"); } catch { return null; }
}
