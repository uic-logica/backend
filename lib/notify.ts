import { prisma } from "@/lib/prisma";
import { type EmailContent, renderEmail } from "@/lib/email-layout";
import { frontendOrigin } from "@/lib/linkedin-oauth";
import { logEmail } from "@/lib/email-log";
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
export async function notifyUser(
  userId: string,
  message: string,
  category: Category,
  subject = "LOGICA @ UIC",
  content?: EmailContent,
): Promise<void> {
  await prisma.notification.create({ data: { userId, message } });

  const [user, pref] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    prisma.emailPreference.findUnique({ where: { userId } }),
  ]);
  if (!user) return;
  if (pref && pref[category] === false) {
    console.info(`email skipped: "${subject}", ${category} turned off`);
    await logEmail({ to: user.email, subject, status: "SKIPPED", error: category === "eventReminders" ? "Event emails are off in their settings" : "Announcements are off in their settings" });
    return;
  }
  await emailTo(user.email, subject, content ?? message);
}

/** A plain notification as an email: its paragraphs and a button to the dashboard. */
const plain = (message: string): EmailContent => ({
  paragraphs: message.split(/\n{2,}/),
  button: { label: "Open your dashboard", url: `${frontendOrigin()}/dashboard` },
});

/** One email in the LOGICA layout; a failed send logs and moves on (see notifyUser). */
export async function emailTo(to: string, subject: string, content: EmailContent | string): Promise<void> {
  // Domain only in logs: enough to see "sent to uic.edu" without storing addresses.
  const domain = to.split("@")[1] ?? "?";
  try {
    await sendMail({ to, subject, ...renderEmail(typeof content === "string" ? plain(content) : content) });
    console.info(`email sent: "${subject}" to @${domain}`);
  } catch (err) {
    console.error(`email failed: "${subject}" to @${domain}`, err);
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
  content?: EmailContent,
  category: Category = "announcements",
): Promise<void> {
  try {
    if (person.userId) await notifyUser(person.userId, message, category, subject, content);
    else if (person.email) await emailTo(person.email, subject, content ?? message);
  } catch (err) {
    console.error("tell: notification failed", err);
  }
}

/** Notifies every user RSVP'd GOING to an event — used by the event feed and material uploads. */
export async function notifyEventGoing(
  eventId: string,
  message: string,
  category: Category,
  exceptUserId?: string,
  email?: { subject: string; content: EmailContent },
): Promise<void> {
  const rsvps = await prisma.rsvp.findMany({
    where: { eventId, status: "GOING", ...(exceptUserId && { userId: { not: exceptUserId } }) },
    select: { userId: true },
  });
  await Promise.all(rsvps.map((r) => notifyUser(r.userId, message, category, email?.subject, email?.content)));
}
