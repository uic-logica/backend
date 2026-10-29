import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { noticeRsvp } from "@/lib/notices";
import { prisma } from "@/lib/prisma";

/** The signed-in person's RSVP to this event: `{ status }`, null if they haven't answered. The public event page reads it. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id: eventId } = await params;
  const rsvp = await prisma.rsvp.findUnique({ where: { eventId_userId: { eventId, userId: session.user.id } }, select: { status: true } });
  return NextResponse.json({ status: rsvp?.status ?? null });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { status } = (payload ?? {}) as { status?: unknown };
  if (status !== "GOING" && status !== "NOT_GOING") {
    return NextResponse.json({ error: "`status` must be GOING or NOT_GOING." }, { status: 400 });
  }

  const { id: eventId } = await params;
  const before = await prisma.rsvp.findUnique({ where: { eventId_userId: { eventId, userId: session.user.id } }, select: { status: true } });
  const rsvp = await prisma.rsvp.upsert({
    where: { eventId_userId: { eventId, userId: session.user.id } },
    create: { eventId, userId: session.user.id, status },
    update: { status },
  });
  if (status === "GOING") await noticeRsvp(session.user.id, eventId, before?.status);
  return NextResponse.json(rsvp);
}
