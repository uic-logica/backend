import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runsWorkspace } from "@/lib/authz";
import { authorSelect, blogSlug } from "@/lib/blog";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

const ACTIONS = ["publish", "reject", "unpublish"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Exec only. `{ action: "publish" }` puts it on /blog, `{ action: "reject",
 * note }` sends it back to the author with the note, `{ action: "unpublish",
 * note? }` takes a live post down (it goes back to the author too).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!runsWorkspace(session.user)) {
    return NextResponse.json({ error: "Only the exec board reviews blog posts." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const { action, note } = (payload ?? {}) as { action?: unknown; note?: unknown };
  if (!ACTIONS.includes(action as Action)) {
    return NextResponse.json({ error: "`action` must be publish, reject or unpublish." }, { status: 400 });
  }
  const reviewNote = typeof note === "string" ? note.trim().slice(0, 2000) : "";
  if (action === "reject" && !reviewNote) {
    return NextResponse.json({ error: "Tell the author what to change." }, { status: 400 });
  }

  const { id } = await params;
  const post = await prisma.blogPost.findUnique({ where: { id } });
  if (!post || post.status === "DRAFT") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const allowed = action === "unpublish" ? post.status === "PUBLISHED" : post.status === "SUBMITTED";
  if (!allowed) return NextResponse.json({ error: `This post is ${post.status.toLowerCase()}.` }, { status: 409 });

  const updated = await prisma.blogPost.update({
    where: { id },
    data:
      action === "publish"
        ? { status: "PUBLISHED", publishedAt: new Date(), reviewNote: null, slug: post.slug ?? blogSlug(post.title, post.id) }
        : { status: "REJECTED", reviewNote: reviewNote || null },
    include: { author: authorSelect },
  });

  await notifyUser(
    post.authorId,
    action === "publish"
      ? `Your blog post "${post.title}" is live on the site.`
      : action === "reject"
        ? `Your blog post "${post.title}" needs changes: ${reviewNote}`
        : `Your blog post "${post.title}" was taken off the site.${reviewNote ? ` ${reviewNote}` : ""}`,
    "decisions",
    undefined,
    undefined,
    `/dashboard/blog?id=${post.id}`,
  );
  return NextResponse.json(updated);
}
