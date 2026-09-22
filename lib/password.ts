import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for member and speaker accounts (see AUTH.md). Uses Node's built-in
 * scrypt rather than pulling in bcrypt/argon2 — one well-understood KDF
 * already in the standard library, no new dependency.
 *
 * Stored as `scrypt:<salt-hex>:<hash-hex>` so the format is self-describing
 * if we ever need to migrate to a different KDF later.
 */
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) return false;
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A one-time password the speaker is forced to replace on first login — see mustChangePassword. */
export function generateTempPassword(): string {
  // logica-lean: base64url, trimmed to 12 chars — random enough for a value
  // that's emailed once and immediately invalidated on first use.
  return randomBytes(9).toString("base64url").slice(0, 12);
}

/** "Ada Lovelace" -> "ada.lovelace", falling back to the email's local part if there's no usable name. */
export function slugifyUsername(name: string | null | undefined, email: string): string {
  const base = (name?.trim() || email.split("@")[0])
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return base || "speaker";
}

/** Member credentials: 144 bits of randomness, URL-safe and password-manager friendly. */
export function generateMemberPassword(): string {
  return randomBytes(18).toString("base64url");
}
