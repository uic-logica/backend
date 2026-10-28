import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { teamTasks } from "@/lib/teams";

/**
 * The signed-in member's team and its tasks: the ones assigned to their
 * GitHub login, and the open ones nobody has taken. Task lists are null
 * when GitHub can't be reached.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { team: true, github: true } });
  if (!user?.team) return NextResponse.json({ team: null, github: user?.github ?? null, mine: [], open: [] });

  const tasks = (await teamTasks())?.filter((t) => t.team === user.team) ?? null;
  return NextResponse.json({
    team: user.team,
    github: user.github,
    mine: tasks && tasks.filter((t) => user.github && t.assignees.includes(user.github)),
    open: tasks && tasks.filter((t) => !t.assignees.length),
  });
}
