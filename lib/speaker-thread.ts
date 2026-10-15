import { prisma } from "@/lib/prisma";

/**
 * Linked guests share one thread and one event. A linked entry points at
 * the lead (threadId); the lead's own threadId is null. These helpers turn
 * any member's id into the lead's id and the whole group.
 */

/** The id the group's messages live on, or null if there's no such guest. */
export async function threadLead(submissionId: string): Promise<string | null> {
  const s = await prisma.speakerSubmission.findUnique({ where: { id: submissionId }, select: { id: true, threadId: true } });
  return s ? (s.threadId ?? s.id) : null;
}

/** Everyone on a thread (lead first), with what notices need. */
export async function threadMembers(lead: string) {
  const rows = await prisma.speakerSubmission.findMany({
    where: { OR: [{ id: lead }, { threadId: lead }] },
    select: { id: true, name: true, email: true, user: { select: { id: true } } },
  });
  return rows.sort((a, b) => (a.id === lead ? -1 : b.id === lead ? 1 : 0));
}

/**
 * Link `otherId` into `id`'s thread: its messages move over and it takes the
 * group's event if it had none. Only a guest that's on its own can join.
 */
export async function linkGuests(id: string, otherId: string): Promise<{ error: string; status: number } | { lead: string }> {
  if (id === otherId) return { error: "Pick a different guest.", status: 400 };
  const lead = await threadLead(id);
  const other = await prisma.speakerSubmission.findUnique({
    where: { id: otherId },
    select: { id: true, threadId: true, eventId: true, _count: { select: { sharing: true } } },
  });
  if (!lead || !other) return { error: "Not found.", status: 404 };
  if (other.threadId || other._count.sharing) return { error: "That guest is already linked with someone. Separate them first.", status: 409 };
  const leadRow = await prisma.speakerSubmission.findUniqueOrThrow({ where: { id: lead }, select: { eventId: true } });
  await prisma.$transaction([
    prisma.speakerMessage.updateMany({ where: { submissionId: otherId }, data: { submissionId: lead } }),
    prisma.speakerSubmission.update({
      where: { id: otherId },
      data: { threadId: lead, ...(leadRow.eventId && !other.eventId ? { eventId: leadRow.eventId } : {}) },
    }),
  ]);
  return { lead };
}

/** Undo a link: a member leaves the group; separating the lead releases everyone. Messages stay on the lead. */
export async function separateGuest(id: string): Promise<number> {
  const s = await prisma.speakerSubmission.findUnique({ where: { id }, select: { threadId: true } });
  if (!s) return 0;
  const { count } = await prisma.speakerSubmission.updateMany({
    where: s.threadId ? { id } : { threadId: id },
    data: { threadId: null },
  });
  return count;
}
