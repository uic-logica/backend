import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runsWorkspace } from "@/lib/authz";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

const MAX_BODY = 2000;

/**
 * The speaker's thread with the board, one per submission.
 *
 * Two kinds of reader: any board member (they share one side of every
 * thread) and the one speaker the submission belongs to. Anyone else —
 * including a plain MEMBER and a speaker asking for someone else's id —
 * gets a 403 here, not just a hidden button in the UI.
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
  if (speaker?.speakerSubmissionId !== submissionId) {
    return { error: "This thread isn't yours.", status: 403 } as const;
  }
  return { user: session.user, board: false } as const;
}

const AUTHOR = { select: { id: true, name: true, role: true, accountKind: true } } as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await participant(id);
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });

  const messages = await prisma.speakerMessage.findMany({
    where: { submissionId: id },
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

  const submission = await prisma.speakerSubmission.findUnique({
    where: { id },
    select: { id: true, name: true, user: { select: { id: true } } },
  });
  if (!submission) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const message = await prisma.speakerMessage.create({
    data: { submissionId: id, authorId: who.user.id, body: body.trim() },
    include: { author: AUTHOR },
  });

  // Only the speaker gets pinged. Notifying every board member on every
  // message is noise; they live in the directory. logica-lean: revisit if
  // the board starts missing threads.
  if (who.board && submission.user) {
    await notifyUser(
      submission.user.id,
      `The LOGICA board replied about your talk.`,
      "announcements",
    );
  }

  return NextResponse.json(message, { status: 201 });
}
