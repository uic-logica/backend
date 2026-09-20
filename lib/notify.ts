import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";

type Category = "eventReminders" | "announcements";

/**
 * Every "tell a user something" path in the app goes through this: writes
 * the in-app Notification, then emails it too unless they've turned that
 * category off (EmailPreference — defaults to on, matches the GET default
 * in app/api/email-preferences/route.ts).
 *
 * ponytail: fire-and-forget, no retry/queue — a failed send logs and moves
 * on rather than losing the in-app notification too. Revisit with a real
 * queue if email volume/reliability ever becomes a problem.
 */
export async function notifyUser(userId: string, message: string, category: Category): Promise<void> {
  await prisma.notification.create({ data: { userId, message } });

  const [user, pref] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    prisma.emailPreference.findUnique({ where: { userId } }),
  ]);
  if (!user) return;
  if (pref && pref[category] === false) return;

  try {
    await sendMail({
      to: user.email,
      subject: "LOGICA @ UIC",
      text: message,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px"><p style="margin:0">${message}</p></div>`,
    });
  } catch (err) {
    console.error(`notifyUser: email failed for ${userId}`, err);
  }
}

/** Notifies every user RSVP'd GOING to an event — used by the event feed and material uploads. */
export async function notifyEventGoing(eventId: string, message: string, category: Category, exceptUserId?: string): Promise<void> {
  const rsvps = await prisma.rsvp.findMany({
    where: { eventId, status: "GOING", ...(exceptUserId && { userId: { not: exceptUserId } }) },
    select: { userId: true },
  });
  await Promise.all(rsvps.map((r) => notifyUser(r.userId, message, category)));
}
