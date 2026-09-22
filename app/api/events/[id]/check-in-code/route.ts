import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isBoardAccount } from "@/lib/authz";
import { CHECK_IN_CODE_MINUTES, generateCheckInCode } from "@/lib/check-in";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/** Board+ only: the event's current check-in code, to put back on screen. */
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isBoardAccount(session.user)) {
    return NextResponse.json({ error: "Only board members can see check-in codes." }, { status: 403 });
  }

  const { id } = await params;
  const open = await prisma.checkInCode.findUnique({ where: { eventId: id } });
  if (!open || open.expiresAt <= new Date()) {
    return NextResponse.json({ error: "Check-in isn't open for this event." }, { status: 404 });
  }
  return NextResponse.json({ code: open.code, expiresAt: open.expiresAt });
}

/** Board+ only: opens check-in with a new code. Replaces any earlier code for the event. */
export async function POST(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isBoardAccount(session.user)) {
    return NextResponse.json({ error: "Only board members can open check-in." }, { status: 403 });
  }

  const { id } = await params;
  const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const code = generateCheckInCode();
  const expiresAt = new Date(Date.now() + CHECK_IN_CODE_MINUTES * 60_000);
  await prisma.checkInCode.upsert({
    where: { eventId: id },
    create: { eventId: id, code, expiresAt },
    update: { code, expiresAt },
  });
  return NextResponse.json({ code, expiresAt }, { status: 201 });
}
