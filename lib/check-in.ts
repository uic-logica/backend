import { randomInt } from "node:crypto";

/** No 0/O, 1/I/L, so a code read off a projector can't be mistyped as another. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** How long an event's check-in code works after a board member opens it. */
export const CHECK_IN_CODE_MINUTES = 180;

/** A random `CODE_LENGTH`-character check-in code. */
export function generateCheckInCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Uppercases and drops spaces and dashes, so "abc-234" matches "ABC234". */
export function normalizeCheckInCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export type CheckInCodeResult = "ok" | "closed" | "expired" | "wrong";

/** Checks a submitted code against the event's open code, if any. */
export function checkCode(
  open: { code: string; expiresAt: Date } | null,
  submitted: string,
  now = new Date(),
): CheckInCodeResult {
  if (!open) return "closed";
  if (open.expiresAt <= now) return "expired";
  return normalizeCheckInCode(submitted) === open.code ? "ok" : "wrong";
}
