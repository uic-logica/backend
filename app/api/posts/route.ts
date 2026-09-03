import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// logica-lean: bare-minimum Post CRUD for #7 (BE 4). No pagination, no
// edit/delete, no likes/comments — real ticket designs those.

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { author: { select: { id: true, name: true, role: true } } },
  });
  return NextResponse.json(posts);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { body } = (payload ?? {}) as { body?: unknown };
  if (typeof body !== "string" || body.trim().length === 0) {
    return NextResponse.json({ error: "`body` is required." }, { status: 400 });
  }

  const post = await prisma.post.create({
    data: { body: body.trim(), authorId: session.user.id },
    include: { author: { select: { id: true, name: true, role: true } } },
  });
  return NextResponse.json(post, { status: 201 });
}
