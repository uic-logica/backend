import { createSign } from "node:crypto";

/**
 * Access to the club's Google Drive: browsing for Documents, and one write,
 * saving receipt photos into Receipts/<YYYY-MM> (uploadReceipt).
 *
 * A service account, not per-user OAuth: every exec already shares one Drive,
 * so per-person consent buys nothing and costs a token-refresh story per
 * person. The account is a Content manager on the club's shared drive and
 * can see nothing else in anyone's Drive.
 *
 * logica-lean: the service-account JWT is signed here with node:crypto
 * instead of pulling in googleapis (tens of megabytes) for two endpoints.
 * Swap in google-auth-library if this ever needs write scope, impersonation,
 * or anything beyond a bearer token. Nothing else would change.
 */

// Full Drive scope because receipts are uploaded; the account only has the
// club's shared drive, so that's still all it can touch.
const SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";

const FIELDS =
  "files(id,name,mimeType,iconLink,webViewLink,modifiedTime,size,owners(displayName)),nextPageToken";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
  owners?: { displayName: string }[];
};

function config() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!email || !key || !root) return null;
  // Env vars can't hold real newlines in most dashboards, so the PEM is
  // pasted with literal \n. Accept both.
  return { email, key: key.replace(/\\n/g, "\n"), root };
}

export function driveConfigured(): boolean {
  return config() !== null;
}

const b64 = (value: object | string) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const settings = config();
  if (!settings) throw new Error("Google Drive isn't connected.");
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: settings.email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).end().sign(settings.key, "base64url");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!response.ok) {
    // Google's body echoes the assertion on some errors — don't log it.
    throw new Error("Google rejected the service account. Check the key and that the Drive API is on.");
  }
  const body = (await response.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early rather than racing the expiry.
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return cachedToken.value;
}

/** Cheap memo so clicking between folders doesn't hit Google every time. */
const listings = new Map<string, { at: number; files: DriveFile[] }>();
const CACHE_MS = 5 * 60 * 1000;

async function query(q: string, cacheKey: string): Promise<DriveFile[]> {
  const hit = listings.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.files;

  const token = await accessToken();
  const url = new URL(FILES_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("pageSize", "200");
  url.searchParams.set("orderBy", "folder,name");
  // Shared Drives are invisible without these two.
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Google Drive didn't answer. Try again in a moment.");
  const body = (await response.json()) as { files?: DriveFile[] };
  const files = body.files ?? [];
  listings.set(cacheKey, { at: Date.now(), files });
  return files;
}

/** Drive query strings are single-quoted; an unescaped quote changes the query. */
const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function rootFolderId(): string {
  const settings = config();
  if (!settings) throw new Error("Google Drive isn't connected.");
  return settings.root;
}

export async function listFolder(folderId?: string): Promise<DriveFile[]> {
  const id = folderId?.trim() || rootFolderId();
  return query(`'${escape(id)}' in parents and trashed = false`, `folder:${id}`);
}

/**
 * Search by name. Scoped to the configured root by asking Drive for matches
 * and keeping only what the service account can see anyway — the account has
 * no access outside the shared folder, so the scope is enforced by Google,
 * not by us.
 */
export async function searchFiles(term: string): Promise<DriveFile[]> {
  const needle = term.trim();
  if (!needle) return [];
  return query(`name contains '${escape(needle)}' and trashed = false`, `search:${needle.toLowerCase()}`);
}

/** Tests and the dev switcher need to drop the memo. */
export function clearDriveCache() {
  listings.clear();
  folderIds.clear();
  cachedToken = null;
}

const folderIds = new Map<string, string>();

/** The id of folder `name` under `parent`, created if it isn't there. */
async function ensureFolder(parent: string, name: string): Promise<string> {
  const key = `${parent}/${name}`;
  const known = folderIds.get(key);
  if (known) return known;
  const token = await accessToken();
  const url = new URL(FILES_URL);
  url.searchParams.set("q", `'${escape(parent)}' in parents and name = '${escape(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`);
  url.searchParams.set("fields", "files(id)");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const found = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!found.ok) throw new Error("Google Drive didn't answer. Try again in a moment.");
  let id = ((await found.json()) as { files?: { id: string }[] }).files?.[0]?.id;
  if (!id) {
    const created = await fetch(`${FILES_URL}?supportsAllDrives=true&fields=id`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
    });
    if (!created.ok) throw new Error("Couldn't create the receipts folder in Drive. Check the service account is a Content manager.");
    id = ((await created.json()) as { id: string }).id;
  }
  folderIds.set(key, id);
  return id;
}

/**
 * Save one receipt photo to Receipts/<YYYY-MM> in the club's Drive and
 * return its link. Folders are made on first use.
 */
export async function uploadReceipt(file: { name: string; mimeType: string; bytes: Buffer }): Promise<{ id: string; url: string }> {
  const receipts = await ensureFolder(rootFolderId(), "Receipts");
  const month = new Date().toISOString().slice(0, 7);
  const folder = await ensureFolder(receipts, month);
  const token = await accessToken();
  const boundary = `logica${Date.now().toString(36)}`;
  const meta = JSON.stringify({ name: file.name, parents: [folder] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const response = await fetch(`${UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!response.ok) throw new Error("Drive didn't take the receipt. Try again in a moment.");
  const saved = (await response.json()) as { id: string; webViewLink?: string };
  return { id: saved.id, url: saved.webViewLink ?? `https://drive.google.com/file/d/${saved.id}/view` };
}
