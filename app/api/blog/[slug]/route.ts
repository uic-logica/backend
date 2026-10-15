import { NextRequest, NextResponse } from "next/server";
import { authorSelect } from "@/lib/blog";
import { prisma } from "@/lib/prisma";

/** Public, no auth: one published post. Drafts and unpublished posts 404. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await prisma.blogPost.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: { id: true, slug: true, title: true, body: true, publishedAt: true, author: authorSelect },
  });
  if (!post) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(post);
}
