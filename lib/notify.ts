import { prisma } from "@/lib/prisma";
import { type EmailContent, renderEmail } from "@/lib/email-layout";
import { frontendOrigin } from "@/lib/linkedin-oauth";
import { logEmail } from "@/lib/email-log";
import { sendMail } from "@/lib/mailer";

import { type Category, modeFor } from "@/lib/email-prefs";

/**
 * Every "tell a user something" path in the app goes through this: writes
 * the in-app Notification, then emails it the way they chose for this
 * category (lib/email-prefs.ts): right away, held for the exec board's 9 AM
 * summary (`emailLater`, sent by /api/cron/daily-summary), or not at all.
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
  link?: string,
): Promise<void> {
  const [user, pref] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, role: true, accountKind: true } }),
    prisma.emailPreference.findUnique({ where: { userId } }),
  ]);
  const mode = user ? modeFor(user, pref?.modes, category) : "OFF";
  await prisma.notification.create({
    data: { userId, message, link: link ?? sitePath(content?.button?.url), emailLater: mode === "SUMMARY" },
  });
  if (!user || mode === "SUMMARY") return;
  if (mode === "OFF") {
    console.info(`email skipped: "${subject}", ${category} turned off`);
    await logEmail({
      to: user.email,
      subject,
      status: "SKIPPED",
      error: "This kind of email is off in their settings",
      ...renderEmail(content ?? plain(message)), // what it would have said
    });
    return;
  }
  await emailTo(user.email, subject, content ?? message);
}

/**
 * The in-app link for a notification: the email's button when it points at
 * our own site (as a path, so it works on any deploy), else nothing.
 */
export function sitePath(url?: string): string | undefined {
  if (!url) return undefined;
  const origin = frontendOrigin();
  if (url.startsWith("/")) return url;
  return url.startsWith(origin) ? url.slice(origin.length) || "/" : undefined;
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
  content: EmailContent | undefined,
  category: Category,
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
  // Everything here is about one event: the notification opens it.
  const link = `/dashboard/events?id=${eventId}`;
  const rsvps = await prisma.rsvp.findMany({
    where: { eventId, status: "GOING", ...(exceptUserId && { userId: { not: exceptUserId } }) },
    select: { userId: true },
  });
  await Promise.all(rsvps.map((r) => notifyUser(r.userId, message, category, email?.subject, email?.content, link)));
}
