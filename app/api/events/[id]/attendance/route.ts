import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isBoardAccount } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/** Board+ only: who has checked in to the event. */
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isBoardAccount(session.user)) {
    return NextResponse.json({ error: "Only board members can see event attendance." }, { status: 403 });
  }

  const { id } = await params;
  const attendances = await prisma.attendance.findMany({
    where: { eventId: id },
    orderBy: { checkedInAt: "asc" },
    select: {
      checkedInAt: true,
      checkedInById: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  return NextResponse.json(attendances);
}

/** Board+ only: checks a member in at the door by email, for anyone who can't use the code. */
export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isBoardAccount(session.user)) {
    return NextResponse.json({ error: "Only board members can check members in." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { email } = (payload ?? {}) as { email?: unknown };
  if (typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "`email` is required." }, { status: 400 });
  }

  const { id: eventId } = await params;
  const [event, member] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } }),
  ]);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  // Accounts are created on first sign-in, so they need to have signed in once.
  if (!member) return NextResponse.json({ error: "No member with that email." }, { status: 404 });

  const attendance = await prisma.attendance.upsert({
    where: { eventId_userId: { eventId, userId: member.id } },
    create: { eventId, userId: member.id, checkedInById: session.user.id },
    update: {},
  });
  return NextResponse.json(attendance, { status: 201 });
}
