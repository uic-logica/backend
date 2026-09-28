/**
 * A member's LinkedIn profile link, cleaned up for storage.
 * Accepts "linkedin.com/in/name", with or without https:// or www., and stores
 * it as a full https URL. Empty clears it. Anything that isn't a linkedin.com
 * address is rejected, so the profile photo and experience we later read from
 * it always point at LinkedIn.
 */
export function normalizeLinkedin(value: string): { ok: true; url: string | null } | { ok: false; error: string } {
  const raw = value.trim();
  if (!raw) return { ok: true, url: null };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "Enter your LinkedIn profile link, like linkedin.com/in/your-name." };
  }
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) {
    return { ok: false, error: "That isn't a LinkedIn link. It should look like linkedin.com/in/your-name." };
  }
  if (url.pathname.length <= 1) {
    return { ok: false, error: "Link to your own profile, like linkedin.com/in/your-name." };
  }
  url.protocol = "https:";
  url.hash = "";
  return { ok: true, url: url.toString().replace(/\/$/, "") };
}
