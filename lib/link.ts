export type ParsedLink = { ok: true; url: string } | { ok: false; reason: "invalid" | "scheme" };

/**
 * Parses a user-supplied http(s) URL.
 *
 * Four places wrote this check separately (events, partner inquiries, board
 * items, MCP event tools). It matters more than it looks: a `javascript:` URL
 * stored here is one the board clicks later, from a page that renders it as a
 * link. `reason` lets each caller keep the wording it already had.
 */
export function parseHttpLink(raw: string): ParsedLink {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "scheme" };
  }
  return { ok: true, url: url.toString() };
}
