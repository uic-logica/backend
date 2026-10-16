export const MAX_BLOG_TITLE = 120;
export const MAX_BLOG_BODY = 20_000;

/** What the author can send: a title and a body, both optional on an edit. */
export function parseBlogInput(
  input: unknown,
  { partial }: { partial: boolean },
): { ok: true; data: { title?: string; body?: string } } | { ok: false; error: string } {
  const { title, body } = (input ?? {}) as Record<string, unknown>;
  const data: { title?: string; body?: string } = {};
  if (title !== undefined || !partial) {
    if (typeof title !== "string" || !title.trim()) return { ok: false, error: "Give the post a title." };
    if (title.trim().length > MAX_BLOG_TITLE) return { ok: false, error: `Titles are limited to ${MAX_BLOG_TITLE} characters.` };
    data.title = title.trim();
  }
  if (body !== undefined || !partial) {
    if (typeof body !== "string" || !body.trim()) return { ok: false, error: "The post needs a body." };
    if (body.trim().length > MAX_BLOG_BODY) {
      return { ok: false, error: `Posts are limited to ${MAX_BLOG_BODY.toLocaleString("en-US")} characters.` };
    }
    data.body = body.trim();
  }
  return { ok: true, data };
}

/** "Our first Hack Night!" + id "clx9abc123" -> "our-first-hack-night-abc123". */
export function blogSlug(title: string, id: string): string {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  const suffix = id.slice(-6);
  return words ? `${words}-${suffix}` : suffix;
}

/** First ~200 characters of the first paragraph, for the /blog list. */
export function blogExcerpt(body: string): string {
  const first = body.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  return first.length > 200 ? `${first.slice(0, 197).trimEnd()}...` : first;
}

export const authorSelect = { select: { id: true, name: true, photoUrl: true } } as const;
