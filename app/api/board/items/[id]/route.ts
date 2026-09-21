import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { jsonBody, requireBoard } from "@/lib/board-guard";
import { parseBoardItem } from "@/lib/board-item";
import { prisma } from "@/lib/prisma";

const INCLUDE = {
  owner: { select: { id: true, name: true, email: true } },
  paidBy: { select: { id: true, name: true, email: true } },
  stageChangedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  event: { select: { id: true, title: true, startsAt: true } },
  budget: { select: { id: true, label: true } },
} satisfies Prisma.BoardItemInclude;

/**
 * Update one item. A stage change stamps who moved it and when — that's the
 * treasurer's "who approved this", and the only audit trail here. Everything
 * else is a plain field edit.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;

  const { id } = await params;
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });

  const existing = await prisma.boardItem.findUnique({ where: { id }, select: { kind: true, stage: true } });
  if (!existing) return NextResponse.json({ error: "No such item." }, { status: 404 });

  let data;
  try {
    // The kind is fixed at creation — a spend never becomes a company.
    data = parseBoardItem(body, existing.kind, { creating: false });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const movedStage = typeof data.stage === "string" && data.stage !== existing.stage;

  try {
    const item = await prisma.boardItem.update({
      where: { id },
      data: {
        ...(data as Prisma.BoardItemUncheckedUpdateInput),
        ...(movedStage ? { stageChangedById: gate.user.id, stageChangedAt: new Date() } : {}),
        ...(body.archived === false ? { archivedAt: null } : {}),
      },
      include: INCLUDE,
    });
    return NextResponse.json(item);
  } catch {
    return NextResponse.json(
      { error: "Couldn't save that — check the owner, budget and event you picked still exist." },
      { status: 400 },
    );
  }
}

/**
 * Archive, not delete. A spend that was declined is still a thing the club
 * decided, and the treasurer will be asked about it in three months.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;

  const { id } = await params;
  const existing = await prisma.boardItem.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "No such item." }, { status: 404 });

  await prisma.boardItem.update({ where: { id }, data: { archivedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
