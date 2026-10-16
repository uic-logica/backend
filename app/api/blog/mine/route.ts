import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseBlogInput } from "@/lib/blog";
import { submitBlogPost } from "@/lib/blog-notify";
import { prisma } from "@/lib/prisma";

/** The signed-in member's own posts, every status. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const posts = await prisma.blogPost.findMany({ where: { authorId: session.user.id }, orderBy: { updatedAt: "desc" } });
  return NextResponse.json(posts);
}

/** Start a post. `{ title, body, submit?: true }`; submit sends it straight to the exec board. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.user.accountKind !== "MEMBER") {
    return NextResponse.json({ error: "Only members can write blog posts." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const parsed = parseBlogInput(payload, { partial: false });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const submit = (payload as { submit?: unknown }).submit === true;
  const post = await prisma.blogPost.create({
    data: {
      title: parsed.data.title!,
      body: parsed.data.body!,
      authorId: session.user.id,
      ...(submit && { status: "SUBMITTED", submittedAt: new Date() }),
    },
  });
  if (submit) await submitBlogPost(post.title, session.user.name, post.id);
  return NextResponse.json(post, { status: 201 });
}
