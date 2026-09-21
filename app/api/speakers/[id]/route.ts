import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runsWorkspace } from "@/lib/authz";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

const STATUSES = ["PENDING", "CONFIRMED", "DECLINED"] as const;

/**
 * Public, no auth — fetch a draft's current state to pre-fill the completion
 * form. Scoped to only what the form needs (no `status`/`createdAt`), and
 * stops serving the row entirely once it's been submitted — there's no
 * ongoing reason for a link to keep exposing contact info forever.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const submission = await prisma.speakerSubmission.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      organization: true,
      referredBy: true,
      availability: true,
      needs: true,
      note: true,
      publicOptIn: true,
      submittedAt: true,
    },
  });
  if (!submission) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (submission.submittedAt) {
    return NextResponse.json({ error: "This has already been submitted." }, { status: 410 });
  }

  return NextResponse.json({
    id: submission.id,
    name: submission.name,
    email: submission.email,
    organization: submission.organization,
    referredBy: submission.referredBy,
    availability: submission.availability,
    needs: submission.needs,
    note: submission.note,
    publicOptIn: submission.publicOptIn,
  });
}

/**
 * Board+ only — confirm or decline a speaker submission, and/or attach the
 * scheduled Event to it. Attaching the event is what gives the speaker's own
 * dashboard real attendance numbers, so it's the same call, not a new route.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!runsWorkspace(session.user)) {
    return NextResponse.json({ error: "Only the exec board can update guest submissions for now." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { status, eventId } = (payload ?? {}) as Record<string, unknown>;
  if (status !== undefined && (typeof status !== "string" || !STATUSES.includes(status as (typeof STATUSES)[number]))) {
    return NextResponse.json({ error: `\`status\` must be one of: ${STATUSES.join(", ")}.` }, { status: 400 });
  }
  // `null` unlinks; a string links. Absent leaves it alone, which is why
  // this can't just coalesce to null.
  if (eventId !== undefined && eventId !== null && typeof eventId !== "string") {
    return NextResponse.json({ error: "`eventId` must be an event id or null." }, { status: 400 });
  }
  if (status === undefined && eventId === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { id } = await params;
  const existing = await prisma.speakerSubmission.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const updated = await prisma.speakerSubmission.update({
    where: { id },
    data: {
      ...(status === undefined ? {} : { status: status as (typeof STATUSES)[number] }),
      ...(eventId === undefined ? {} : { eventId: eventId as string | null }),
    },
    omit: { inviteTokenHash: true }, // the invite's hash never leaves lib/invite.ts
    include: { user: { select: { id: true } } }, // id only — never leak passwordHash etc. through this response
  });

  if (updated.user && (status === "CONFIRMED" || status === "DECLINED")) {
    const message =
      status === "CONFIRMED"
        ? "You're confirmed to speak at LOGICA @ UIC — sign in to your portal for details."
        : "Your speaker submission to LOGICA @ UIC was declined.";
    await notifyUser(updated.user.id, message, "announcements");
  }

  return NextResponse.json(updated);
}
