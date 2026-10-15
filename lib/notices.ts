import { eventDetails, when } from "@/lib/event-when";
import { frontendOrigin } from "@/lib/linkedin-oauth";
import { applicantNotice } from "@/lib/membership-application";
import { logEmail } from "@/lib/email-log";
import { emailTo, tell } from "@/lib/notify";
import { openInterview } from "@/lib/interview";
import { prisma } from "@/lib/prisma";

/**
 * The emails people get when the board acts on something of theirs. The
 * dashboard routes and the MCP tools both call these, so a decision made
 * either way reads the same.
 */

type Person = { userId?: string | null; email?: string | null };

/** An application moved: interview, more info, accepted, declined. A repeat of the same status sends nothing. */
export async function noticeApplicant(
  app: { id: string; userId: string | null; email: string; track: string; status: string },
  status: string,
  note = "",
  canReapply = true,
  resend = false,
): Promise<boolean> {
  // A repeat of the same status sends nothing, unless the board asks to resend.
  if (!resend && status === app.status && status !== "NEEDS_INFO") return false;
  const role = app.track === "BOARD_MEMBER" ? "board member" : "Software Teams";
  // Moving to INTERVIEW sends a private link to share when they can meet.
  const interviewLink = status === "INTERVIEW" ? await openInterview(app.id) : undefined;
  const notice = applicantNotice(status, role, note, canReapply, interviewLink);
  if (!notice) return false;
  const userId = app.userId ?? (await prisma.user.findUnique({ where: { email: app.email }, select: { id: true } }))?.id;
  await tell({ userId, email: app.email }, notice.message, `Your LOGICA ${role} application`, notice.content);
  return true;
}

const portal = () => `${frontendOrigin()}/dashboard`;

/** A guest was confirmed or declined. */
export async function noticeGuestDecision(guest: Person, previous: string, status: string) {
  if (status === previous || (status !== "CONFIRMED" && status !== "DECLINED")) return;
  if (status === "CONFIRMED") {
    await tell(guest, "You're confirmed to speak at LOGICA @ UIC. Your talk details are in your portal.", "You're confirmed to speak at LOGICA", {
      preheader: "Your talk details are in your speaker portal.",
      eyebrow: "Speaker confirmed",
      heading: "You're speaking at LOGICA",
      paragraphs: ["Thank you for saying yes. Your talk details, the schedule and your thread with the board are in your speaker portal."],
      button: { label: "Open your portal", url: portal() },
    });
  } else {
    await tell(guest, "Thank you for your interest in speaking at LOGICA @ UIC. We can't fit your talk in this time.", "Your LOGICA speaker submission", {
      heading: "Thank you for your interest",
      paragraphs: ["We can't fit your talk in this time. Thank you for offering to share it with LOGICA."],
    });
  }
}

/** A guest's talk got (or changed) its event. */
export async function noticeGuestScheduled(guest: Person, event: { title: string; startsAt: Date | null; location: string | null }) {
  await tell(guest, `Your talk is on the LOGICA calendar: ${event.title}, ${when(event)}.`, "Your LOGICA talk is scheduled", {
    preheader: `${event.title}: ${when(event)}`,
    eyebrow: "Talk scheduled",
    heading: event.title,
    paragraphs: ["Your talk is on the LOGICA calendar."],
    details: eventDetails(event),
    button: { label: "Open your portal", url: portal() },
  });
}

/** The board (or a co-speaker on a shared thread) wrote in a guest's thread. */
export async function noticeGuestMessage(guest: Person, text: string, from?: string | null) {
  const who = from ?? "The LOGICA board";
  await tell(guest, `${who} wrote about your talk: ${text}`, from ? `${from} wrote in your thread` : "New message from LOGICA", {
    preheader: text.slice(0, 120),
    eyebrow: from ? "Your speaker thread" : "Message from the board",
    heading: from ? `${from} wrote in your thread` : "The LOGICA board wrote to you",
    paragraphs: [],
    quote: text,
    button: { label: "Reply in your portal", url: portal() },
  });
}

/** A guest wrote in their thread: every exec hears about it. */
export async function noticeExecsOfReply(submissionId: string, guestName: string | null, text: string) {
  const execs = await prisma.user.findMany({ where: { accountKind: "MEMBER", role: "EXEC_BOARD" }, select: { id: true } });
  const name = guestName || "A guest";
  const content = {
    preheader: text.slice(0, 120),
    eyebrow: "Speaker thread",
    heading: `${name} replied`,
    paragraphs: [],
    quote: text,
    button: { label: "Open the thread", url: `${frontendOrigin()}/dashboard/speakers?id=${submissionId}` },
  };
  await Promise.all(execs.map((e) => tell({ userId: e.id }, `${name} wrote in their speaker thread: ${text}`, `${name} replied in their thread`, content)));
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
  if (pref?.eventReminders === false) {
    console.info("email skipped: RSVP confirmation, event emails turned off");
    return logEmail({ to: user.email, subject: `You're going: ${event.title}`, status: "SKIPPED", error: "Event emails are off in their settings" });
  }
  await emailTo(user.email, `You're going: ${event.title}`, {
    preheader: when(event),
    eyebrow: "RSVP confirmed",
    heading: `You're going to ${event.title}`,
    paragraphs: [event.startsAt ? "We'll send you a reminder the day before." : "The date isn't set yet. We'll email you when it is."],
    details: eventDetails(event),
    button: event.link ? { label: "Event page", url: event.link } : { label: "View event", url: `${frontendOrigin()}/events/${eventId}` },
    footnote: "Can't make it anymore? Change your RSVP in your dashboard.",
  });
}
