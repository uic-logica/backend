import { NextRequest, NextResponse } from "next/server";
import { requireBoard } from "@/lib/board-guard";
import { markRead, memberThread, messageBody, noticeMemberMessage } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";

const AUTHOR = { select: { id: true, name: true, role: true, accountKind: true } } as const;

async function memberOr404(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, accountKind: true } });
  return user?.accountKind === "MEMBER" ? user : null;
}

/** Exec: one member's thread with the board. Reading it marks it read for this exec. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  const { userId } = await params;
  if (!(await memberOr404(userId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const messages = await prisma.boardMessage.findMany({
    where: { memberId: userId },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { author: AUTHOR },
  });
  await markRead(gate.user.id, memberThread(userId));
  return NextResponse.json(messages);
}

/** Exec writes to a member as the board; also how a new thread starts. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  const { userId } = await params;
  if (!(await memberOr404(userId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = messageBody(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const message = await prisma.boardMessage.create({
    data: { memberId: userId, authorId: gate.user.id, body: parsed.body },
    include: { author: AUTHOR },
  });
  await markRead(gate.user.id, memberThread(userId));
  await noticeMemberMessage(userId, parsed.body);
  return NextResponse.json(message, { status: 201 });
}
