import { NextResponse } from "next/server";
import { requireBoard } from "@/lib/board-guard";
import { PROJECTS } from "@/lib/membership-application";
import { prisma } from "@/lib/prisma";
import { teamTasks } from "@/lib/teams";

/**
 * The Software Teams board: who's on each team, how many tasks each person
 * has open, and who was accepted but isn't on a team yet. Task counts are
 * null when GitHub can't be reached.
 */
export async function GET() {
  const gate = await requireBoard();
  if (gate.error) return gate.error;

  const [placed, accepted, tasks] = await Promise.all([
    prisma.user.findMany({
      where: { accountKind: "MEMBER", team: { not: null } },
      select: { id: true, name: true, email: true, github: true, team: true },
      orderBy: { name: "asc" },
    }),
    prisma.membershipApplication.findMany({
      where: { track: "SOFTWARE_ENGINEER", status: "ACCEPTED", userId: { not: null } },
      select: { userId: true, name: true, email: true, github: true, projects: true, hoursPerWeek: true, decidedAt: true },
      orderBy: { decidedAt: "desc" },
    }),
    teamTasks(),
  ]);

  const seen = new Set(placed.map((u) => u.id));
  const unplaced = accepted.filter((a) => a.userId && !seen.has(a.userId) && seen.add(a.userId));
  return NextResponse.json({
    members: placed.map((u) => ({
      ...u,
      openTasks: tasks ? tasks.filter((t) => u.github && t.assignees.includes(u.github)).length : null,
    })),
    unplaced,
    upForGrabs: tasks
      ? Object.fromEntries(PROJECTS.map((team) => [team, tasks.filter((t) => t.team === team && !t.assignees.length).length]))
      : null,
  });
}
