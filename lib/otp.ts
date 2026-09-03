import { randomInt } from "node:crypto";

/** Digits in the emailed sign-in code. */
const OTP_LENGTH = 6;

/** How long an emailed code stays valid, in seconds. */
export const OTP_MAX_AGE_SECONDS = 10 * 60;

/**
 * A cryptographically random `OTP_LENGTH`-digit code, zero-padded so every
 * value in the range is equally likely (`randomInt`, never `Math.random`).
 */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

/**
 * Fails closed: an unset or empty `ALLOWED_EMAIL_DOMAIN` rejects every
 * sign-in rather than allowing every sign-in.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
  if (!domain) return false;
  const address = email?.trim().toLowerCase();
  if (!address) return false;
  return address.endsWith(`@${domain}`);
}

/** Plain-text + HTML body for the sign-in code email. */
export function otpEmail(code: string, minutes: number) {
  const subject = `${code} is your LOGICA @ UIC sign-in code`;
  const text = `Your LOGICA @ UIC sign-in code is ${code}.\n\nIt expires in ${minutes} minutes. If you didn't request it, ignore this email.\n`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <p style="margin:0 0 16px">Your LOGICA @ UIC sign-in code is:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:0 0 16px">${code}</p>
  <p style="margin:0;color:#555;font-size:14px">It expires in ${minutes} minutes. If you didn't request it, ignore this email.</p>
</div>`;
  return { subject, text, html };
}
