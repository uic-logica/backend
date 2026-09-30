import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { notifyEventGoing } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { validatePostBody } from "@/lib/request-limits";

/** Signed-in — notes/thoughts on this specific event, same idea as the general feed. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const posts = await prisma.post.findMany({
    where: { eventId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { author: { select: { id: true, name: true, role: true } } },
  });
  return NextResponse.json(posts);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { body } = (payload ?? {}) as { body?: unknown };
  const validated = validatePostBody(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const post = await prisma.post.create({
    data: { body: validated.body, authorId: session.user.id, eventId: id },
    include: { author: { select: { id: true, name: true, role: true } } },
  });

  const who = post.author.name?.trim() || "Someone";
  try {
    await notifyEventGoing(id, `${who} posted on ${event.title}: ${post.body}`, "eventReminders", session.user.id);
  } catch (error) {
    console.error("Failed to notify event attendees about new post", error);
  }

  return NextResponse.json(post, { status: 201 });
}
