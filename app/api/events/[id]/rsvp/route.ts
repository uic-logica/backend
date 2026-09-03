import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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
  const rsvp = await prisma.rsvp.upsert({
    where: { eventId_userId: { eventId, userId: session.user.id } },
    create: { eventId, userId: session.user.id, status },
    update: { status },
  });
  return NextResponse.json(rsvp);
}
