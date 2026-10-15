import { NextResponse } from "next/server";
import { requireBoard } from "@/lib/board-guard";
import { refreshDelivery } from "@/lib/email-log";
import { prisma } from "@/lib/prisma";

/**
 * Exec only: the last 300 emails the site tried to send, newest first, with
 * whether each went out and (for Resend) whether it was delivered. Reading
 * the log refreshes delivery for recent emails that aren't settled yet.
 */
export async function GET() {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  const rows = await prisma.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 });
  const updates = await refreshDelivery(rows);
  return NextResponse.json(rows.map((r) => ({ ...r, delivery: updates.get(r.id) ?? r.delivery })));
}
