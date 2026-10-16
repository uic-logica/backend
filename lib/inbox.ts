import { prisma } from "@/lib/prisma";
import { tell } from "@/lib/notify";
import { frontendOrigin } from "@/lib/linkedin-oauth";

/** Inbox thread keys: a guest thread lives on its lead submission, a member thread on the member. */
export const speakerThread = (lead: string) => `speaker:${lead}`;
export const memberThread = (userId: string) => `member:${userId}`;

export async function markRead(userId: string, thread: string) {
  await prisma.threadRead.upsert({
    where: { userId_thread: { userId, thread } },
    create: { userId, thread },
    update: { readAt: new Date() },
  });
}

export const MAX_BODY = 2000;

/** A message body from a request, or the error to send back. */
export function messageBody(payload: unknown): { body: string } | { error: string } {
  const { body } = (payload ?? {}) as Record<string, unknown>;
  if (typeof body !== "string" || !body.trim()) return { error: "`body` is required." };
  if (body.length > MAX_BODY) return { error: `Messages are limited to ${MAX_BODY} characters.` };
  return { body: body.trim() };
}

/** The board wrote in a member's thread. */
export async function noticeMemberMessage(memberId: string, text: string) {
  await tell({ userId: memberId }, `The LOGICA board wrote to you: ${text}`, "New message from the LOGICA board", {
    preheader: text.slice(0, 120),
    eyebrow: "Message from the board",
    heading: "The LOGICA board wrote to you",
    paragraphs: [],
    quote: text,
    button: { label: "Reply in your dashboard", url: `${frontendOrigin()}/dashboard/messages` },
  });
}

/** A member wrote to the board: every exec hears about it. */
export async function noticeExecsOfMemberMessage(member: { id: string; name: string | null; email: string }, text: string) {
  const execs = await prisma.user.findMany({ where: { accountKind: "MEMBER", role: "EXEC_BOARD", NOT: { id: member.id } }, select: { id: true } });
  const name = member.name || member.email;
  const content = {
    preheader: text.slice(0, 120),
    eyebrow: "Messages",
    heading: `${name} wrote to the board`,
    paragraphs: [],
    quote: text,
    button: { label: "Open the thread", url: `${frontendOrigin()}/dashboard/messages?thread=${memberThread(member.id)}` },
  };
  await Promise.all(execs.map((e) => tell({ userId: e.id }, `${name} wrote to the board: ${text}`, `${name} wrote to the board`, content)));
}
