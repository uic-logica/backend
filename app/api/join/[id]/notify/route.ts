import { NextRequest, NextResponse } from "next/server";
import { requireBoard } from "@/lib/board-guard";
import { noticeApplicant } from "@/lib/notices";
import { prisma } from "@/lib/prisma";

/**
 * Exec only: send the applicant their current status email again (one that
 * was missed, or that went out before emails worked). For Interview it
 * includes a fresh availability link. Pending has no email.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  const app = await prisma.membershipApplication.findUnique({
    where: { id: (await params).id },
    select: { id: true, userId: true, email: true, track: true, status: true, reviewNote: true, canReapply: true },
  });
  if (!app) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const sent = await noticeApplicant(app, app.status, app.reviewNote ?? "", app.canReapply, true);
  if (!sent) return NextResponse.json({ error: "Pending applications don't have a status email." }, { status: 409 });
  return NextResponse.json({ sent: true, status: app.status });
}
