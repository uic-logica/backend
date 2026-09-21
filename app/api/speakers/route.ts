import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runsWorkspace } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { clientKey, overAttemptLimit } from "@/lib/rate-limit";
import { parseFreshSubmission } from "@/lib/speaker-submission";

// logica-lean: bare-minimum speaker/guest intake (frontend#36). No email
// receipt on submit, no admin notification — whoever needs those picks it
// up as a follow-up.

/**
 * Board+ only — the full submission list, including contact info, draft
 * status, and (if invited) the linked portal account's username/LinkedIn/
 * resume — this is what the admin directory (frontend `/admin/speakers`)
 * reads.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!runsWorkspace(session.user)) {
    return NextResponse.json({ error: "Only the exec board can view guest submissions for now." }, { status: 403 });
  }

  const submissions = await prisma.speakerSubmission.findMany({
    orderBy: { createdAt: "desc" },
    // Explicit, not `include` — a bare findMany would hand the board every
    // column, and one of them is now the invite's hash. Nothing outside
    // lib/invite.ts has any business seeing that.
    omit: { inviteTokenHash: true },
    include: {
      user: { select: { id: true, username: true, linkedin: true, resumeFilename: true } },
      event: { select: { id: true, title: true, startsAt: true, location: true } },
    },
  });
  // `inviteLive` is what the UI actually needs: is there an unused link out
  // there right now, or does this guest need a new one?
  return NextResponse.json(
    submissions.map(({ inviteExpiresAt, inviteUsedAt, ...row }) => ({
      ...row,
      inviteUsedAt,
      inviteLive:
        !row.user && !inviteUsedAt && !!inviteExpiresAt && inviteExpiresAt > new Date(),
      inviteExpiresAt,
    })),
  );
}

/** Public, no auth — a stranger filling out the form cold, start to finish. Rate-limited per IP. */
export async function POST(request: NextRequest) {
  if (overAttemptLimit(`speaker-submit:${clientKey(request)}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many submissions. Try again later." }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = parseFreshSubmission(payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const submission = await prisma.speakerSubmission.create({
    data: { ...parsed.data, submittedAt: new Date() },
  });
  return NextResponse.json({ id: submission.id }, { status: 201 });
}
