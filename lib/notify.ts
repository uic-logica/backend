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
export async function notifyUser(userId: string, message: string, category: Category, subject = "LOGICA @ UIC"): Promise<void> {
  await prisma.notification.create({ data: { userId, message } });

  const [user, pref] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    prisma.emailPreference.findUnique({ where: { userId } }),
  ]);
  if (!user) return;
  if (pref && pref[category] === false) return;
  await emailTo(user.email, subject, message);
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** One plain email; a failed send logs and moves on (see notifyUser). */
export async function emailTo(to: string, subject: string, message: string): Promise<void> {
  try {
    await sendMail({
      to,
      subject,
      text: message,
      html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;line-height:1.5">${escapeHtml(message)
        .split(/\n{2,}/)
        .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
        .join("")}</div>`,
    });
  } catch (err) {
    console.error(`email to ${to} failed`, err);
  }
}

/**
 * Tell one person something: their account gets the in-app notification and
 * the email (respecting their preferences); someone without an account yet
 * (an applicant, a guest before sign-up) is emailed at the address on file.
 */
export async function tell(
  person: { userId?: string | null; email?: string | null },
  message: string,
  subject: string,
  category: Category = "announcements",
): Promise<void> {
  try {
    if (person.userId) await notifyUser(person.userId, message, category, subject);
    else if (person.email) await emailTo(person.email, subject, message);
  } catch (err) {
    console.error("tell: notification failed", err);
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
