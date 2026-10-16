import { NextResponse } from "next/server";
import { requireBoard } from "@/lib/board-guard";
import { memberThread, speakerThread } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";

const STATUS: Record<string, string> = { PENDING: "Applicant", INTERVIEW: "Applicant · Interview", ACCEPTED: "Member", DECLINED: "Applicant · Declined" };

/**
 * Exec: every conversation in one list, newest activity first. Guest threads
 * (speakers, candidates, partners) and member/applicant threads with the
 * board. Unread means the other side wrote after this exec last opened it.
 */
export async function GET() {
  const gate = await requireBoard();
  if (gate.error) return gate.error;

  const [guestLast, memberLast, reads] = await Promise.all([
    // ponytail: distinct over every message, fine at club scale; a lastMessageAt column if threads reach the thousands.
    prisma.speakerMessage.findMany({
      distinct: ["submissionId"],
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { accountKind: true } },
        submission: { select: { id: true, name: true, email: true, organization: true, sharing: { select: { name: true } } } },
      },
    }),
    prisma.boardMessage.findMany({
      distinct: ["memberId"],
      orderBy: { createdAt: "desc" },
      include: { member: { select: { id: true, name: true, email: true, role: true } } },
    }),
    prisma.threadRead.findMany({ where: { userId: gate.user.id } }),
  ]);
  // Applications point at users without a relation; oldest first so the latest wins.
  const apps = await prisma.membershipApplication.findMany({
    where: { userId: { in: memberLast.map((m) => m.memberId) } },
    orderBy: { createdAt: "asc" },
    select: { userId: true, status: true },
  });
  const appStatus = new Map(apps.map((a) => [a.userId, a.status]));
  const readAt = new Map(reads.map((r) => [r.thread, r.readAt]));
  const unread = (thread: string, at: Date, fromBoard: boolean) => !fromBoard && at > (readAt.get(thread) ?? new Date(0));

  const threads = [
    ...guestLast.map((m) => {
      const s = m.submission;
      const thread = speakerThread(s.id);
      const fromBoard = m.author.accountKind === "MEMBER";
      return {
        thread,
        kind: "guest" as const,
        id: s.id,
        name: [s.name ?? s.email, ...s.sharing.map((o) => o.name).filter(Boolean)].join(" & "),
        detail: s.organization ? `Guest · ${s.organization}` : "Guest",
        last: { body: m.body, at: m.createdAt, fromBoard },
        unread: unread(thread, m.createdAt, fromBoard),
      };
    }),
    ...memberLast.map((m) => {
      const u = m.member;
      const thread = memberThread(u.id);
      const fromBoard = m.authorId !== u.id;
      const app = appStatus.get(u.id);
      return {
        thread,
        kind: "member" as const,
        id: u.id,
        name: u.name ?? u.email,
        detail: u.role === "MEMBER" && app && app !== "ACCEPTED" ? STATUS[app] : u.role === "MEMBER" ? "Member" : "Board",
        last: { body: m.body, at: m.createdAt, fromBoard },
        unread: unread(thread, m.createdAt, fromBoard),
      };
    }),
  ].sort((a, b) => b.last.at.getTime() - a.last.at.getTime());

  return NextResponse.json(threads);
}
