import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// logica-lean: single-post GET/edit/delete for #7 (BE 4). No ownership
// check beyond role (any BOARD/EXEC_BOARD can edit/delete any post) — real
// ticket decides if authors should be restricted to their own posts.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const post = await prisma.post.findUnique({
    where: { id },
    include: { author: { select: { id: true, name: true, role: true } } },
  });
  if (!post) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(post);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (session.user.role !== "BOARD" && session.user.role !== "EXEC_BOARD") {
    return NextResponse.json({ error: "Only board members can edit posts." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.post.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

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

  const post = await prisma.post.update({
    where: { id },
    data: { body: body.trim() },
    include: { author: { select: { id: true, name: true, role: true } } },
  });
  return NextResponse.json(post);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (session.user.role !== "BOARD" && session.user.role !== "EXEC_BOARD") {
    return NextResponse.json({ error: "Only board members can delete posts." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.post.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.post.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
