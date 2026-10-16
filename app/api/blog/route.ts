import { NextResponse } from "next/server";
import { authorSelect, blogExcerpt } from "@/lib/blog";
import { prisma } from "@/lib/prisma";

/** Public, no auth: the published posts for /blog, newest first, without bodies. */
export async function GET() {
  const posts = await prisma.blogPost.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: 100,
    select: { id: true, slug: true, title: true, body: true, publishedAt: true, author: authorSelect },
  });
  return NextResponse.json(posts.map(({ body, ...post }) => ({ ...post, excerpt: blogExcerpt(body) })));
}
