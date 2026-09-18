import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasRole } from "@/lib/authz";
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

/** Board+ only — confirm or decline a speaker submission. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.user.accountKind !== "MEMBER" || !hasRole(session.user.role, "BOARD")) {
    return NextResponse.json({ error: "Only board members can update speaker submissions." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { status } = (payload ?? {}) as Record<string, unknown>;
  if (typeof status !== "string" || !STATUSES.includes(status as (typeof STATUSES)[number])) {
    return NextResponse.json({ error: `\`status\` must be one of: ${STATUSES.join(", ")}.` }, { status: 400 });
  }

  const { id } = await params;
  const existing = await prisma.speakerSubmission.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const updated = await prisma.speakerSubmission.update({
    where: { id },
    data: { status: status as (typeof STATUSES)[number] },
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
