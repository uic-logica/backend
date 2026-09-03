import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// logica-lean: self check-in only, no QR/code verification — real ticket
// (#7, BE 6) designs the actual check-in mechanism.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { eventId } = (payload ?? {}) as { eventId?: unknown };
  if (typeof eventId !== "string" || eventId.length === 0) {
    return NextResponse.json({ error: "`eventId` is required." }, { status: 400 });
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const attendance = await prisma.attendance.upsert({
    where: { eventId_userId: { eventId, userId: session.user.id } },
    create: { eventId, userId: session.user.id },
    update: {},
  });
  return NextResponse.json(attendance, { status: 201 });
}
