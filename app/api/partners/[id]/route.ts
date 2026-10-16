import { NextRequest, NextResponse } from "next/server";
import { jsonBody, requireBoard } from "@/lib/board-guard";
import { prisma } from "@/lib/prisma";

/** Exec only: `{ eventId, access: true | false }` grants or revokes one event. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  const body = await jsonBody(request);
  const eventId = body?.eventId;
  if (typeof eventId !== "string" || typeof body?.access !== "boolean") {
    return NextResponse.json({ error: "`eventId` and `access` (true or false) are required." }, { status: 400 });
  }

  const { id: userId } = await params;
  const [partner, event] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { accountKind: true } }),
    prisma.event.findUnique({ where: { id: eventId }, select: { id: true } }),
  ]);
  if (partner?.accountKind !== "PARTNER" || !event) {
    return NextResponse.json({ error: "Partner or event not found." }, { status: 404 });
  }

  const key = { userId_eventId: { userId, eventId } };
  if (body.access) {
    await prisma.eventAccess.upsert({ where: key, create: { userId, eventId }, update: {} });
  } else {
    await prisma.eventAccess.deleteMany({ where: { userId, eventId } });
  }
  return NextResponse.json({ userId, eventId, access: body.access });
}
