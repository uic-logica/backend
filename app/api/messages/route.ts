import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { markRead, memberThread, messageBody, noticeExecsOfMemberMessage } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";

const AUTHOR = { select: { id: true, name: true, role: true, accountKind: true } } as const;

/** A member's (or applicant's) own thread with the board. Guests have theirs in the speaker portal. */
async function member() {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) } as const;
  if (session.user.accountKind !== "MEMBER") {
    return { error: NextResponse.json({ error: "Guests message the board from their portal." }, { status: 403 }) } as const;
  }
  return { user: session.user } as const;
}

export async function GET() {
  const me = await member();
  if (me.error) return me.error;
  const messages = await prisma.boardMessage.findMany({
    where: { memberId: me.user.id },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { author: AUTHOR },
  });
  await markRead(me.user.id, memberThread(me.user.id));
  return NextResponse.json(messages);
}

export async function POST(request: NextRequest) {
  const me = await member();
  if (me.error) return me.error;
  const parsed = messageBody(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const message = await prisma.boardMessage.create({
    data: { memberId: me.user.id, authorId: me.user.id, body: parsed.body },
    include: { author: AUTHOR },
  });
  await markRead(me.user.id, memberThread(me.user.id));
  const who = await prisma.user.findUniqueOrThrow({ where: { id: me.user.id }, select: { id: true, name: true, email: true } });
  await noticeExecsOfMemberMessage(who, parsed.body);
  return NextResponse.json(message, { status: 201 });
}
