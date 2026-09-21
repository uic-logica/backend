import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseSpeakerFields } from "@/lib/speaker-submission";

const SELF_FIELDS = {
  id: true,
  name: true,
  email: true,
  username: true,
  linkedin: true,
  bio: true,
  resumeFilename: true, // upload/remove via /api/profile/resume, same as MEMBER accounts
  mustChangePassword: true,
  speakerSubmission: {
    select: {
      id: true,
      organization: true,
      availability: true,
      needs: true,
      note: true,
      status: true,
      submittedAt: true,
      availabilityConfirmedAt: true,
      talkTitle: true,
      slidesUrl: true,
      event: { select: { id: true, title: true, startsAt: true, location: true } },
    },
  },
} as const;

/**
 * How the speaker's own talk is going: who said they're coming, who actually
 * turned up, and how many questions landed on its feed. Only meaningful once
 * the board has attached the scheduled Event to the submission — before that
 * there is nothing to count, and `null` is what says so.
 */
async function talkStats(eventId: string | undefined) {
  if (!eventId) return null;
  const [rsvpGoing, checkedIn, questions] = await Promise.all([
    prisma.rsvp.count({ where: { eventId, status: "GOING" } }),
    prisma.attendance.count({ where: { eventId } }),
    prisma.post.count({ where: { eventId } }),
  ]);
  return { rsvpGoing, checkedIn, questions };
}

/** SPEAKER accounts only — self-view/edit. Availability etc. live on the linked SpeakerSubmission. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.user.accountKind !== "SPEAKER") {
    return NextResponse.json({ error: "Speaker accounts only." }, { status: 403 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: SELF_FIELDS });
  const stats = await talkStats(user?.speakerSubmission?.event?.id);
  return NextResponse.json({ ...user, talkStats: stats });
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.user.accountKind !== "SPEAKER") {
    return NextResponse.json({ error: "Speaker accounts only." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { name, linkedin, bio } = (payload ?? {}) as Record<string, unknown>;
  if (name !== undefined && typeof name !== "string") {
    return NextResponse.json({ error: "`name` must be a string." }, { status: 400 });
  }
  if (linkedin !== undefined && typeof linkedin !== "string") {
    return NextResponse.json({ error: "`linkedin` must be a string." }, { status: 400 });
  }
  if (bio !== undefined && typeof bio !== "string") {
    return NextResponse.json({ error: "`bio` must be a string." }, { status: 400 });
  }

  // organization/availability/needs/note live on SpeakerSubmission — reuse
  // the same validated shape the intake form uses.
  const submissionFields = parseSpeakerFields(payload);
  if (!submissionFields.ok) {
    return NextResponse.json({ error: submissionFields.error }, { status: 400 });
  }
  const { organization, availability, needs, note, talkTitle, slidesUrl } = submissionFields.data;

  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { speakerSubmissionId: true, speakerSubmission: { select: { status: true } } },
  });
  if (!current?.speakerSubmissionId) {
    return NextResponse.json({ error: "No linked submission on file." }, { status: 409 });
  }

  // Two stages. A candidate is still being considered: they can tell us when
  // they're free and talk to the board, and that's the point — we can't ask
  // anyone to prepare a talk we haven't agreed to yet. Talk details unlock
  // when the board confirms them. Enforced here, not just hidden in the UI.
  const confirmed = current.speakerSubmission?.status === "CONFIRMED";
  if (!confirmed && (talkTitle !== undefined || slidesUrl !== undefined)) {
    return NextResponse.json(
      { error: "Talk details unlock once the board confirms your visit." },
      { status: 403 },
    );
  }

  // The candidate's own confirmation: "these windows are final, over to
  // you". Changing the windows clears it, so the board never reads
  // "confirmed" against times that have since moved.
  const { availabilityConfirmed } = (payload ?? {}) as Record<string, unknown>;
  if (availabilityConfirmed !== undefined && typeof availabilityConfirmed !== "boolean") {
    return NextResponse.json({ error: "`availabilityConfirmed` must be a boolean." }, { status: 400 });
  }
  if (availabilityConfirmed === true && !availability?.length) {
    return NextResponse.json(
      { error: "Add at least one window before confirming." },
      { status: 400 },
    );
  }
  const availabilityConfirmedAt =
    availabilityConfirmed === true
      ? new Date()
      : availabilityConfirmed === false || availability !== undefined
        ? null
        : undefined;

  // Submission update runs first: the user update's nested `speakerSubmission`
  // select below reads within the same transaction, so it only reflects
  // these changes if they've already landed by the time it runs.
  const [, user] = await prisma.$transaction([
    prisma.speakerSubmission.update({
      where: { id: current.speakerSubmissionId },
      data: { organization, availability, needs, note, talkTitle, slidesUrl, availabilityConfirmedAt },
    }),
    prisma.user.update({
      where: { id: session.user.id },
      data: { name, linkedin, bio },
      select: SELF_FIELDS,
    }),
  ]);

  const stats = await talkStats(user.speakerSubmission?.event?.id);
  return NextResponse.json({ ...user, talkStats: stats });
}
