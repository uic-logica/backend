import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isBoardAccount, runsWorkspace } from "@/lib/authz";
import { STATUSES, isStatus } from "@/lib/membership-application";
import { noticeApplicant } from "@/lib/notices";
import { prisma } from "@/lib/prisma";
import { isTeam, placeOnTeam } from "@/lib/teams";

/**
 * Board only: moves an application between statuses. NEEDS_INFO needs a
 * `note` for the applicant; DECLINED takes `canReapply` (default true).
 * ACCEPTED on a Software Teams application can take `team` to place them.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isBoardAccount(session.user)) {
    return NextResponse.json({ error: "Only board members can update applications." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { status, note, canReapply, team } = (payload ?? {}) as { status?: unknown; note?: unknown; canReapply?: unknown; team?: unknown };
  if (!isStatus(status)) {
    return NextResponse.json({ error: `\`status\` must be one of: ${STATUSES.join(", ")}.` }, { status: 400 });
  }
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (status === "NEEDS_INFO" && (trimmed.length < 10 || trimmed.length > 1000)) {
    return NextResponse.json({ error: "Say what the applicant should add (10-1000 characters)." }, { status: 400 });
  }
  if (canReapply !== undefined && typeof canReapply !== "boolean") {
    return NextResponse.json({ error: "`canReapply` must be true or false." }, { status: 400 });
  }

  if (team !== undefined && team !== null && !isTeam(team)) {
    return NextResponse.json({ error: "`team` must be one of the Software Teams projects." }, { status: 400 });
  }

  const { id } = await params;
  const existing = await prisma.membershipApplication.findUnique({
    where: { id },
    select: { id: true, userId: true, email: true, track: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const now = new Date();
  const updated = await prisma.membershipApplication.update({
    where: { id },
    data: {
      status,
      ...(status === "NEEDS_INFO" ? { reviewNote: trimmed, reviewedAt: now } : {}),
      ...(status === "DECLINED" ? { canReapply: canReapply ?? true } : {}),
      ...(status === "DECLINED" || status === "ACCEPTED" ? { decidedAt: now } : {}),
    },
  });

  if (status === "ACCEPTED" && isTeam(team) && existing.track === "SOFTWARE_ENGINEER" && existing.userId) {
    await placeOnTeam(existing.userId, team, false);
  }
  await noticeApplicant(existing, status, trimmed, canReapply ?? true);
  return NextResponse.json(updated);
}

/** Exec only: remove an application for good (test entries, duplicates). The applicant's account, if any, stays. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!runsWorkspace(session.user)) {
    return NextResponse.json({ error: "Only the exec board can delete applications." }, { status: 403 });
  }
  const { id } = await params;
  const { count } = await prisma.membershipApplication.deleteMany({ where: { id } });
  if (!count) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}

