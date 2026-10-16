import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runsWorkspace } from "@/lib/authz";
import { authorSelect } from "@/lib/blog";
import { prisma } from "@/lib/prisma";

/** Exec only: everything past draft, waiting posts first. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!runsWorkspace(session.user)) {
    return NextResponse.json({ error: "Only the exec board reviews blog posts." }, { status: 403 });
  }
  const posts = await prisma.blogPost.findMany({
    where: { status: { not: "DRAFT" } },
    orderBy: [{ submittedAt: "desc" }],
    take: 200,
    include: { author: authorSelect },
  });
  return NextResponse.json(posts);
}
