import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const LINKEDIN_STATE_COOKIE = "logica.linkedin.state";
export const LINKEDIN_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

function signature(state: string, secret: string): string {
  return createHmac("sha256", secret).update(state).digest("base64url");
}

export function createLinkedInState(secret: string): { state: string; cookie: string } {
  const state = randomBytes(32).toString("base64url");
  return { state, cookie: `${state}.${signature(state, secret)}` };
}

export function verifyLinkedInState(state: string | null, cookie: string | undefined, secret: string): boolean {
  if (!state || !cookie) return false;
  const separator = cookie.lastIndexOf(".");
  if (separator < 1) return false;
  const cookieState = cookie.slice(0, separator);
  const received = cookie.slice(separator + 1);
  const expected = signature(cookieState, secret);
  if (state !== cookieState || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export function validateLinkedInImage(
  contentType: string | null,
  bytes: ArrayBuffer,
  maxBytes = LINKEDIN_PHOTO_MAX_BYTES,
): { ok: true; mimeType: string; data: Uint8Array<ArrayBuffer> } | { ok: false; error: string } {
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mimeType?.startsWith("image/")) return { ok: false, error: "LinkedIn returned a non-image photo." };
  if (bytes.byteLength === 0) return { ok: false, error: "LinkedIn returned an empty photo." };
  if (bytes.byteLength > maxBytes) return { ok: false, error: "LinkedIn photo exceeds the 2 MB limit." };
  const data = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  data.set(new Uint8Array(bytes));
  return { ok: true, mimeType, data };
}
