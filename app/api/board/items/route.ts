import { NextRequest, NextResponse } from "next/server";
import type { BoardItemKind, Prisma } from "@prisma/client";
import { jsonBody, requireBoard } from "@/lib/board-guard";
import { parseBoardItem, validStage } from "@/lib/board-item";
import { prisma } from "@/lib/prisma";

/**
 * The board's two pipelines — money and outreach — over one table. See the
 * BoardItem doc comment in prisma/schema.prisma for why they share a shape.
 *
 * Board+ only, both verbs. Everyone on the board can see and change
 * everything: the club is a dozen people and hiding a spend from the outreach
 * lead helps nobody. `ownerId` says whose move it is, not who may look.
 */

const INCLUDE = {
  owner: { select: { id: true, name: true, email: true } },
  paidBy: { select: { id: true, name: true, email: true } },
  stageChangedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  event: { select: { id: true, title: true, startsAt: true } },
  budget: { select: { id: true, label: true } },
} satisfies Prisma.BoardItemInclude;

function kindOf(value: string | null): BoardItemKind | null {
  return value === "MONEY" || value === "OUTREACH" ? value : null;
}

export async function GET(request: NextRequest) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;

  const params = request.nextUrl.searchParams;
  const kind = kindOf(params.get("kind"));
  if (params.get("kind") && !kind) {
    return NextResponse.json({ error: "kind must be MONEY or OUTREACH." }, { status: 400 });
  }

  const stage = params.get("stage")?.toUpperCase();
  if (stage && kind && !validStage(kind, stage)) {
    return NextResponse.json({ error: `"${stage}" isn't a stage for ${kind}.` }, { status: 400 });
  }

  const where: Prisma.BoardItemWhereInput = {
    ...(kind ? { kind } : {}),
    ...(stage ? { stage } : {}),
    // Archived is opt-in: the default view is live work, not history.
    ...(params.get("archived") === "true" ? { NOT: { archivedAt: null } } : { archivedAt: null }),
    ...(params.get("owner") === "me" ? { ownerId: gate.user.id } : {}),
  };

  const items = await prisma.boardItem.findMany({
    where,
    include: INCLUDE,
    // Whatever has a deadline comes first, soonest at the top; the rest by
    // most recently touched. Postgres sorts NULLs last on ASC by default,
    // which is exactly what's wanted here.
    orderBy: [{ nextStepAt: "asc" }, { updatedAt: "desc" }],
    take: 500,
  });
  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;

  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });

  const kind = kindOf(String(body.kind ?? ""));
  if (!kind) return NextResponse.json({ error: "kind must be MONEY or OUTREACH." }, { status: 400 });

  let data;
  try {
    data = parseBoardItem(body, kind, { creating: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  try {
    const item = await prisma.boardItem.create({
      data: {
        ...(data as Prisma.BoardItemUncheckedCreateInput),
        kind,
        createdById: gate.user.id,
        stageChangedById: gate.user.id,
        stageChangedAt: new Date(),
      },
      include: INCLUDE,
    });
    return NextResponse.json(item, { status: 201 });
  } catch {
    // A bad ownerId/budgetId/eventId is the only realistic failure here, and
    // it's the caller's mistake, not ours.
    return NextResponse.json(
      { error: "Couldn't save that — check the owner, budget and event you picked still exist." },
      { status: 400 },
    );
  }
}
