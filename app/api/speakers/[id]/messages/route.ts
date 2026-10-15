import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runsWorkspace } from "@/lib/authz";
import { noticeExecsOfReply, noticeGuestMessage } from "@/lib/notices";
import { prisma } from "@/lib/prisma";
import { threadLead, threadMembers } from "@/lib/speaker-thread";

const MAX_BODY = 2000;

/**
 * The speaker's thread with the board, one per submission, or one per group
 * when guests are linked (co-founders, a panel): any member's id reads and
 * writes the same thread, stored on the lead (lib/speaker-thread.ts).
 *
 * Two kinds of reader: exec board members (they share one side of every
 * thread) and the speakers on that thread. Anyone else, including a plain
 * MEMBER and a speaker asking for someone else's id, gets a 403 here, not
 * just a hidden button in the UI.
 */
async function participant(submissionId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in.", status: 401 } as const;

  if (session.user.accountKind === "MEMBER") {
    if (!runsWorkspace(session.user)) {
      return { error: "Only board members can read speaker threads.", status: 403 } as const;
    }
    return { user: session.user, board: true } as const;
  }

  const speaker = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { speakerSubmissionId: true },
  });
  const [mine, target] = await Promise.all([
    speaker?.speakerSubmissionId ? threadLead(speaker.speakerSubmissionId) : null,
    threadLead(submissionId),
  ]);
  if (!mine || mine !== target) {
    return { error: "This thread isn't yours.", status: 403 } as const;
  }
  return { user: session.user, board: false } as const;
}

const AUTHOR = { select: { id: true, name: true, role: true, accountKind: true } } as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await participant(id);
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });

  const lead = (await threadLead(id)) ?? id;
  const messages = await prisma.speakerMessage.findMany({
    where: { submissionId: lead },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { author: AUTHOR },
  });
  return NextResponse.json(messages);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await participant(id);
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { body } = (payload ?? {}) as Record<string, unknown>;
  if (typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "`body` is required." }, { status: 400 });
  }
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: `Messages are limited to ${MAX_BODY} characters.` }, { status: 400 });
  }

  const lead = await threadLead(id);
  if (!lead) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const message = await prisma.speakerMessage.create({
    data: { submissionId: lead, authorId: who.user.id, body: body.trim() },
    include: { author: AUTHOR },
  });

  // Board writes: every guest on the thread gets it by email. A guest writes:
  // the other guests on the thread and every exec do.
  const members = await threadMembers(lead);
  if (who.board) {
    await Promise.all(members.map((m) => noticeGuestMessage({ userId: m.user?.id, email: m.email }, body.trim())));
  } else {
    const author = members.find((m) => m.user?.id === who.user.id);
    await noticeExecsOfReply(id, author?.name ?? null, body.trim());
    await Promise.all(
      members.filter((m) => m !== author).map((m) => noticeGuestMessage({ userId: m.user?.id, email: m.email }, body.trim(), author?.name)),
    );
  }

  return NextResponse.json(message, { status: 201 });
}
