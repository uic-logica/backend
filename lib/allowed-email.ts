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
