import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isBoardAccount } from "@/lib/authz";
import { STATUSES, isStatus } from "@/lib/membership-application";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

/**
 * Board only: moves an application between statuses. NEEDS_INFO needs a
 * `note` for the applicant; DECLINED takes `canReapply` (default true).
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

  const { status, note, canReapply } = (payload ?? {}) as { status?: unknown; note?: unknown; canReapply?: unknown };
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

  const { id } = await params;
  const existing = await prisma.membershipApplication.findUnique({
    where: { id },
    select: { id: true, userId: true, email: true, track: true },
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

  if (status === "NEEDS_INFO") {
    try {
      const userId = existing.userId
        ?? (await prisma.user.findUnique({ where: { email: existing.email }, select: { id: true } }))?.id;
      const role = existing.track === "BOARD_MEMBER" ? "board" : "build team";
      if (userId) await notifyUser(userId, `LOGICA needs a bit more on your ${role} application: ${trimmed}`, "announcements");
    } catch (err) {
      console.error(`join review: notify failed for ${id}`, err);
    }
  }
  return NextResponse.json(updated);
}
