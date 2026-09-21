import { prisma } from "@/lib/prisma";

/**
 * Who's actually showing up, and to what. Read-only, no new tables — every
 * number here is aggregated out of Event / Rsvp / Attendance / User, which
 * the club has been filling since check-in shipped.
 *
 * "Active" is one check-in inside 90 days. RSVPs are reported next to
 * attendance rather than blended into it: the gap between who said they'd
 * come and who came is the number the board actually wants.
 *
 * Lives in lib/ because both GET /api/board/insights and the `club_insights`
 * MCP tool answer the same question, and two copies would drift.
 *
 * logica-lean: no date-range parameter and no caching. Nine aggregates over
 * a club-sized table is a few milliseconds; add a range picker when someone
 * asks for last semester specifically.
 */
export const ACTIVE_DAYS = 90;

export async function clubInsights() {
  const activeSince = new Date(Date.now() - ACTIVE_DAYS * 24 * 60 * 60 * 1000);
  const members = { accountKind: "MEMBER" as const };

  const [
    totalMembers,
    newMembers,
    activeUserIds,
    events,
    goingByEvent,
    attendedByEvent,
    attendanceByUser,
    speakersByStatus,
    applicationsByStatus,
  ] = await Promise.all([
    prisma.user.count({ where: members }),
    prisma.user.count({ where: { ...members, createdAt: { gte: activeSince } } }),
    prisma.attendance.findMany({
      where: { checkedInAt: { gte: activeSince } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.event.findMany({
      orderBy: { startsAt: "desc" },
      take: 20,
      select: { id: true, title: true, startsAt: true, location: true },
    }),
    prisma.rsvp.groupBy({ by: ["eventId"], where: { status: "GOING" }, _count: { _all: true } }),
    prisma.attendance.groupBy({ by: ["eventId"], _count: { _all: true } }),
    prisma.attendance.groupBy({
      by: ["userId"],
      _count: { _all: true },
      orderBy: { _count: { userId: "desc" } },
      take: 10,
    }),
    prisma.speakerSubmission.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.membershipApplication.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const going = new Map(goingByEvent.map((r) => [r.eventId, r._count._all]));
  const attended = new Map(attendedByEvent.map((r) => [r.eventId, r._count._all]));

  // groupBy returns ids, not names — one extra query beats ten.
  const topPeople = await prisma.user.findMany({
    where: { id: { in: attendanceByUser.map((r) => r.userId) } },
    select: { id: true, name: true, email: true, major: true, gradYear: true },
  });
  const byId = new Map(topPeople.map((u) => [u.id, u]));

  const tally = (rows: { status: string; _count: { _all: number } }[]) =>
    Object.fromEntries(rows.map((r) => [r.status, r._count._all]));

  return {
    members: {
      total: totalMembers,
      joinedRecently: newMembers,
      active: activeUserIds.length,
      lapsed: Math.max(0, totalMembers - activeUserIds.length),
      activeWindowDays: ACTIVE_DAYS,
    },
    events: events.map((event) => {
      const said = going.get(event.id) ?? 0;
      const came = attended.get(event.id) ?? 0;
      return {
        ...event,
        going: said,
        attended: came,
        // Null, not 0 — nobody RSVP'd is a different fact from nobody came.
        showRate: said > 0 ? Math.round((came / said) * 100) : null,
      };
    }),
    topAttendees: attendanceByUser
      .map((row) => {
        const person = byId.get(row.userId);
        return person ? { ...person, attended: row._count._all } : null;
      })
      .filter((p) => p !== null),
    speakers: tally(speakersByStatus),
    applications: tally(applicationsByStatus),
  };
}
