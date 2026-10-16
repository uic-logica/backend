import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseBlogInput } from "@/lib/blog";
import { submitBlogPost } from "@/lib/blog-notify";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

async function ownPost(id: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  const post = await prisma.blogPost.findUnique({ where: { id } });
  if (!post || post.authorId !== session.user.id) {
    return { error: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  if (post.status === "PUBLISHED") {
    return { error: NextResponse.json({ error: "This post is live. Ask an exec to unpublish it first." }, { status: 409 }) };
  }
  return { post, user: session.user };
}

/**
 * Edit a draft, a submitted post or one that came back. `submit: true` sends
 * it to the exec board, `submit: false` pulls it back to a draft.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const found = await ownPost((await params).id);
  if (found.error) return found.error;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const parsed = parseBlogInput(payload, { partial: true });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { submit } = payload as { submit?: unknown };
  const submitting = submit === true && found.post.status !== "SUBMITTED";
  const post = await prisma.blogPost.update({
    where: { id: found.post.id },
    data: {
      ...parsed.data,
      ...(submitting && { status: "SUBMITTED", submittedAt: new Date() }),
      ...(submit === false && { status: "DRAFT", submittedAt: null }),
    },
  });
  if (submitting) await submitBlogPost(post.title, found.user.name, post.id);
  return NextResponse.json(post);
}

/** Delete your own post, unless it is live. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const found = await ownPost((await params).id);
  if (found.error) return found.error;
  await prisma.blogPost.delete({ where: { id: found.post.id } });
  return new NextResponse(null, { status: 204 });
}
