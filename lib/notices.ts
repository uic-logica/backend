import { when } from "@/lib/event-when";
import { frontendOrigin } from "@/lib/linkedin-oauth";
import { applicantMessage } from "@/lib/membership-application";
import { emailTo, tell } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

/**
 * The emails people get when the board acts on something of theirs. The
 * dashboard routes and the MCP tools both call these, so a decision made
 * either way reads the same.
 */

type Person = { userId?: string | null; email?: string | null };

/** An application moved: interview, more info, accepted, declined. A repeat of the same status sends nothing. */
export async function noticeApplicant(
  app: { userId: string | null; email: string; track: string; status: string },
  status: string,
  note = "",
  canReapply = true,
) {
  if (status === app.status && status !== "NEEDS_INFO") return;
  const role = app.track === "BOARD_MEMBER" ? "board member" : "Software Teams";
  const message = applicantMessage(status, role, note, canReapply);
  if (!message) return;
  const userId = app.userId ?? (await prisma.user.findUnique({ where: { email: app.email }, select: { id: true } }))?.id;
  await tell({ userId, email: app.email }, message, `Your LOGICA ${role} application`);
}

/** A guest was confirmed or declined. */
export async function noticeGuestDecision(guest: Person, previous: string, status: string) {
  if (status === previous || (status !== "CONFIRMED" && status !== "DECLINED")) return;
  await tell(
    guest,
    status === "CONFIRMED"
      ? `You're confirmed to speak at LOGICA @ UIC. Your talk details are in your portal: ${frontendOrigin()}/dashboard`
      : "Thank you for your interest in speaking at LOGICA @ UIC. We can't fit your talk in this time.",
    status === "CONFIRMED" ? "You're confirmed to speak at LOGICA" : "Your LOGICA speaker submission",
  );
}

/** A guest's talk got (or changed) its event. */
export async function noticeGuestScheduled(guest: Person, event: { title: string; startsAt: Date | null; location: string | null }) {
  await tell(guest, `Your talk is on the LOGICA calendar: ${event.title}, ${when(event)}.`, "Your LOGICA talk is scheduled");
}

/** The board wrote in a guest's thread. */
export async function noticeGuestMessage(guest: Person, text: string) {
  await tell(guest, `The LOGICA board wrote about your talk:\n\n${text}\n\nReply in your portal: ${frontendOrigin()}/dashboard`, "New message from LOGICA");
}

/** A guest wrote in their thread: every exec hears about it. */
export async function noticeExecsOfReply(submissionId: string, guestName: string | null, text: string) {
  const execs = await prisma.user.findMany({ where: { accountKind: "MEMBER", role: "EXEC_BOARD" }, select: { id: true } });
  const name = guestName || "A guest";
  await Promise.all(
    execs.map((e) =>
      tell(
        { userId: e.id },
        `${name} wrote in their speaker thread:\n\n${text}\n\n${frontendOrigin()}/dashboard/speakers?id=${submissionId}`,
        `${name} replied in their thread`,
      ),
    ),
  );
}

/**
 * Someone RSVP'd going: a confirmation email with the when and where (no
 * in-app notification for something they just did). Respects their event
 * email setting; changing an existing GOING sends nothing.
 */
export async function noticeRsvp(userId: string, eventId: string, previous: string | undefined) {
  if (previous === "GOING") return console.info("email skipped: RSVP confirmation, already going");
  const [user, pref, event] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.emailPreference.findUnique({ where: { userId } }),
    prisma.event.findUnique({ where: { id: eventId }, select: { title: true, startsAt: true, location: true, link: true } }),
  ]);
  if (!user || !event) return;
  if (pref?.eventReminders === false) return console.info("email skipped: RSVP confirmation, event emails turned off");
  const reminder = event.startsAt ? " We'll remind you the day before." : " We'll email you when the date is set.";
  await emailTo(
    user.email,
    `You're going: ${event.title}`,
    `You're going to ${event.title}, ${when(event)}.${reminder}${event.link ? `\n\nEvent page: ${event.link}` : ""}`,
  );
}
