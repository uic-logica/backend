import { NextResponse } from "next/server";
import { partnerAuth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * A partner club's whole dashboard: the events exec granted it, with RSVP
 * and check-in counts. Counts only, never who: attendees are our members.
 */
export async function GET() {
  const session = await partnerAuth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.user.accountKind !== "PARTNER") {
    return NextResponse.json({ error: "Only partner club accounts use this." }, { status: 403 });
  }
  const events = await prisma.event.findMany({
    where: { partners: { some: { userId: session.user.id } } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      link: true,
      startsAt: true,
      _count: { select: { attendances: true, rsvps: { where: { status: "GOING" } } } },
    },
  });
  return NextResponse.json(
    events.map(({ _count, ...e }) => ({ ...e, going: _count.rsvps, checkedIn: _count.attendances })),
  );
}
