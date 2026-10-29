import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isBoardAccount } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

/** Board+ only, like attendance: who RSVP'd going, so the board knows the headcount (and how much pizza). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isBoardAccount(session.user)) {
    return NextResponse.json({ error: "Only board members can see who's going." }, { status: 403 });
  }
  const { id: eventId } = await params;
  const going = await prisma.rsvp.findMany({
    where: { eventId, status: "GOING" },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return NextResponse.json(going.map((r) => r.user));
}
