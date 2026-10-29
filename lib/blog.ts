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

/** A picture paragraph: ![caption](/api/blog/images/<id>), only our own uploads. */
export const BLOG_IMAGE = /^!\[([^\]]*)\]\((\/api\/blog\/images\/[a-z0-9]+)\)$/;

/** A paragraph as plain text: links keep their words, ## and - markers go. */
const plain = (p: string) =>
  p.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^#{1,3} |^- /gm, "").replace(/\s+/g, " ").trim();

/** First ~200 characters of the first text paragraph (not a picture or heading), for the /blog list. */
export function blogExcerpt(body: string): string {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim());
  const first = plain(paragraphs.find((p) => p && !BLOG_IMAGE.test(p) && !/^#{1,3} [^\n]*$/.test(p)) ?? "");
  return first.length > 200 ? `${first.slice(0, 197).trimEnd()}...` : first;
}

/** The post's first picture, shown as its cover on /blog. */
export function blogCover(body: string): string | null {
  for (const p of body.split(/\n\s*\n/)) {
    const image = BLOG_IMAGE.exec(p.trim());
    if (image) return image[2];
  }
  return null;
}

export const authorSelect = { select: { id: true, name: true, photoUrl: true } } as const;
