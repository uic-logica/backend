import { NextRequest, NextResponse } from "next/server";
import type { Officer, Prisma, Role } from "@prisma/client";
import { jsonBody, requireBoard } from "@/lib/board-guard";
import { prisma } from "@/lib/prisma";

/**
 * The club roster, board's view: who's here, what they do, when they last
 * showed up. This is also where an item's owner comes from, so it's board-
 * readable — but changing someone's role or officer title is exec only.
 */
const OFFICERS: Officer[] = ["PRESIDENT", "TREASURER", "SECRETARY", "OUTREACH", "OTHER"];
const ROLES: Role[] = ["MEMBER", "BOARD", "EXEC_BOARD"];

export async function GET(request: NextRequest) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;

  const query = request.nextUrl.searchParams.get("q")?.trim();
  const where: Prisma.UserWhereInput = {
    accountKind: "MEMBER",
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { major: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ role: "desc" }, { name: "asc" }],
    take: 500,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      officer: true,
      major: true,
      gradYear: true,
      createdAt: true,
      _count: { select: { attendances: true, posts: true } },
      attendances: {
        orderBy: { checkedInAt: "desc" },
        take: 1,
        select: { checkedInAt: true, event: { select: { title: true } } },
      },
    },
  });

  return NextResponse.json(
    users.map(({ _count, attendances, ...user }) => ({
      ...user,
      eventsAttended: _count.attendances,
      postsMade: _count.posts,
      lastSeenAt: attendances[0]?.checkedInAt ?? null,
      lastSeenAt_event: attendances[0]?.event.title ?? null,
    })),
  );
}

/**
 * Exec only. Promoting someone to the board hands them the club's finances
 * and every guest's contact details, so it is not a board-wide power.
 */
export async function PATCH(request: NextRequest) {
  const gate = await requireBoard("EXEC_BOARD");
  if (gate.error) return gate.error;

  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });

  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Which member?" }, { status: 400 });

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, accountKind: true, role: true },
  });
  if (!target || target.accountKind !== "MEMBER") {
    return NextResponse.json({ error: "No such member." }, { status: 404 });
  }

  const data: Prisma.UserUpdateInput = {};

  if (body.role !== undefined) {
    const role = String(body.role) as Role;
    if (!ROLES.includes(role)) {
      return NextResponse.json({ error: `Role must be one of: ${ROLES.join(", ")}.` }, { status: 400 });
    }
    // Nobody demotes themselves out of the only seat that can promote again.
    if (target.id === gate.user.id && role !== "EXEC_BOARD") {
      return NextResponse.json(
        { error: "You can't take yourself off the exec board — ask another exec to do it." },
        { status: 400 },
      );
    }
    data.role = role;
  }

  if (body.officer !== undefined) {
    if (body.officer === null || body.officer === "") {
      data.officer = null;
    } else {
      const officer = String(body.officer) as Officer;
      if (!OFFICERS.includes(officer)) {
        return NextResponse.json(
          { error: `Officer must be one of: ${OFFICERS.join(", ")}.` },
          { status: 400 },
        );
      }
      data.officer = officer;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, officer: true },
  });
  return NextResponse.json(updated);
}
