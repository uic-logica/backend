import { NextRequest, NextResponse } from "next/server";
import { requireBoard } from "@/lib/board-guard";
import { noticeGuestMessage } from "@/lib/notices";
import { prisma } from "@/lib/prisma";
import { threadLead, threadMembers } from "@/lib/speaker-thread";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

/**
 * Exec only: ask a guest for their availability again, for a given range
 * (a date fell through, or plans moved). Records the request, clears their
 * "availability confirmed" so the board isn't reading stale times, and posts
 * the ask in their thread, which emails them. Confirming new times clears it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const { from, to, note } = (payload ?? {}) as Record<string, unknown>;
  if (typeof from !== "string" || !DATE.test(from) || typeof to !== "string" || !DATE.test(to) || to < from) {
    return NextResponse.json({ error: "Pick the first and last day you want their availability for." }, { status: 400 });
  }
  const extra = typeof note === "string" ? note.trim().slice(0, 1000) : "";

  const id = (await params).id;
  const lead = await threadLead(id);
  if (!lead) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const at = new Date();
  const members = await threadMembers(lead);
  // Linked guests share the ask: everyone on the thread updates their times.
  await prisma.speakerSubmission.updateMany({
    where: { id: { in: members.map((m) => m.id) } },
    data: { availabilityRequest: { from, to, note: extra || null, at: at.toISOString() }, availabilityConfirmedAt: null },
  });

  const range = from === to ? day(from) : `${day(from)} to ${day(to)}`;
  const body = `Could you share your availability for ${range}? Update your times in your portal and confirm them, and we'll lock in the date.${extra ? `\n\n${extra}` : ""}`;
  await prisma.speakerMessage.create({ data: { submissionId: lead, authorId: gate.user.id, body } });
  await Promise.all(members.map((m) => noticeGuestMessage({ userId: m.user?.id, email: m.email }, body)));
  return NextResponse.json({ asked: members.length, from, to });
}
