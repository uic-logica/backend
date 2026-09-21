import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { parseSpeakerFields } from "@/lib/speaker-submission";
import { type Caller } from "@/lib/mcp-token";
import { type Stage, STAGE_LABELS, runsTheClub } from "@/lib/stage";

type Json = Record<string, unknown>;

export type Tool = {
  name: string;
  description: string;
  /** Which of the five see this tool at all. */
  stages: Stage[];
  inputSchema: Json;
  run: (input: Json, caller: Caller) => Promise<unknown>;
};

const str = (d: string) => ({ type: "string", description: d });
const none = { type: "object", properties: {}, additionalProperties: false };

function fail(message: string): never {
  throw new Error(message);
}

/** Everything a guest's tools operate on hangs off their one submission. */
async function submissionOf(caller: Caller) {
  if (!caller.submissionId) fail("No speaker submission is linked to you.");
  const row = await prisma.speakerSubmission.findUnique({
    where: { id: caller.submissionId },
    include: {
      event: { select: { id: true, title: true, startsAt: true, location: true } },
    },
  });
  return row ?? fail("Your submission could not be found.");
}

const WINDOW = {
  type: "object",
  required: ["startDate", "endDate", "startTime", "endTime"],
  properties: {
    startDate: str("First date you could come in, YYYY-MM-DD"),
    endDate: str("Last date of the window, YYYY-MM-DD"),
    startTime: str("Earliest time of day, HH:MM (24h, Chicago time)"),
    endTime: str("Latest time of day, HH:MM (24h, Chicago time)"),
  },
  additionalProperties: false,
};

export const TOOLS: Tool[] = [
  // ---- Everyone -------------------------------------------------------
  {
    name: "whoami",
    description:
      "Who you are on the LOGICA platform and what you can do here. Call this first if you are unsure which tools apply.",
    stages: ["CANDIDATE", "SPEAKER", "MEMBER", "BOARD", "EXEC_BOARD"],
    inputSchema: none,
    run: async (_input, caller) => ({
      name: caller.name,
      email: caller.email,
      stage: caller.stage,
      role: STAGE_LABELS[caller.stage],
      tools: toolsFor(caller.stage).map((t) => t.name),
      note: "Day-to-day chat happens in the LOGICA Discord. This platform is for the things that need a record: availability, talks, RSVPs and the board's decisions.",
    }),
  },

  // ---- Candidate: one job, agree a date -------------------------------
  {
    name: "get_my_visit",
    description:
      "Your current status with LOGICA: whether you are still a candidate or a confirmed speaker, the availability we have on file, and whether you have confirmed it.",
    stages: ["CANDIDATE", "SPEAKER"],
    inputSchema: none,
    run: async (_input, caller) => {
      const s = await submissionOf(caller);
      return {
        stage: caller.stage,
        availability: s.availability ?? [],
        availabilityConfirmedAt: s.availabilityConfirmedAt,
        talkTitle: s.talkTitle,
        slidesUrl: s.slidesUrl,
        scheduledEvent: s.event,
        whatWeNeed:
          caller.stage === "CANDIDATE"
            ? s.availabilityConfirmedAt
              ? "Nothing — the board is checking your windows against the calendar."
              : "Confirmed availability. Use set_availability, then confirm_availability."
            : [
                !s.talkTitle && "a talk title (set_talk)",
                !s.slidesUrl && "a link to your slides (set_talk)",
              ]
                .filter(Boolean)
                .join(" and ") || "Nothing — you're all set.",
      };
    },
  },
  {
    name: "set_availability",
    description:
      "Replace the windows when you could come in and speak. Give every window that works — more options means a better chance of finding a date. This does NOT confirm them; call confirm_availability when the list is final.",
    stages: ["CANDIDATE", "SPEAKER"],
    inputSchema: {
      type: "object",
      required: ["windows"],
      properties: {
        windows: {
          type: "array",
          description: "The full replacement list of availability windows.",
          items: WINDOW,
        },
      },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const parsed = parseSpeakerFields({ availability: input.windows });
      if (!parsed.ok) fail(parsed.error);
      const windows = parsed.data.availability ?? [];
      for (const w of windows) {
        if (w.startTime >= w.endTime) {
          fail(`Window ${w.startDate} ends at or before it starts.`);
        }
      }
      const s = await submissionOf(caller);
      await prisma.speakerSubmission.update({
        where: { id: s.id },
        // Changing the windows un-confirms them, exactly as it does in the UI.
        data: { availability: windows, availabilityConfirmedAt: null },
      });
      return {
        saved: windows,
        confirmed: false,
        next: "Call confirm_availability when this list is final — the board only acts on confirmed windows.",
      };
    },
  },
  {
    name: "confirm_availability",
    description:
      "Tell the board your availability is final and they can work out a date. Requires at least one window on file.",
    stages: ["CANDIDATE", "SPEAKER"],
    inputSchema: none,
    run: async (_input, caller) => {
      const s = await submissionOf(caller);
      const windows = (s.availability as unknown[] | null) ?? [];
      if (!windows.length) {
        fail("Add at least one window with set_availability before confirming.");
      }
      const updated = await prisma.speakerSubmission.update({
        where: { id: s.id },
        data: { availabilityConfirmedAt: new Date() },
      });
      return {
        confirmedAt: updated.availabilityConfirmedAt,
        windows,
        next: "The board will come back to you in your thread. Nothing else to do.",
      };
    },
  },

  // ---- Speaker: a confirmed talk to prepare ---------------------------
  {
    name: "set_talk",
    description:
      "Set your talk title and/or the link to your slides. Only available once the board has confirmed you as a speaker. Slides must be a URL, not a file, so the deck opens on whatever laptop is in the room.",
    stages: ["SPEAKER"],
    inputSchema: {
      type: "object",
      properties: {
        talkTitle: str("The title students will see on the poster."),
        slidesUrl: str("https:// link to your deck (Google Slides, Canva, a PDF in Drive…)."),
      },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const parsed = parseSpeakerFields(input);
      if (!parsed.ok) fail(parsed.error);
      const s = await submissionOf(caller);
      const updated = await prisma.speakerSubmission.update({
        where: { id: s.id },
        data: {
          talkTitle: parsed.data.talkTitle,
          slidesUrl: parsed.data.slidesUrl,
        },
      });
      return { talkTitle: updated.talkTitle, slidesUrl: updated.slidesUrl };
    },
  },
  {
    name: "get_talk_stats",
    description:
      "How your own talk is filling up: RSVPs, check-ins, and questions on its feed. Empty until the board attaches your talk to a scheduled event.",
    stages: ["SPEAKER"],
    inputSchema: none,
    run: async (_input, caller) => {
      const s = await submissionOf(caller);
      if (!s.eventId) {
        return { scheduled: false, note: "The board hasn't attached your talk to a date yet." };
      }
      const [rsvpGoing, checkedIn, questions] = await Promise.all([
        prisma.rsvp.count({ where: { eventId: s.eventId, status: "GOING" } }),
        prisma.attendance.count({ where: { eventId: s.eventId } }),
        prisma.post.count({ where: { eventId: s.eventId } }),
      ]);
      return { scheduled: true, event: s.event, rsvpGoing, checkedIn, questions };
    },
  },

  // ---- Guests: the board thread ---------------------------------------
  {
    name: "read_board_thread",
    description: "Read your message thread with the LOGICA board.",
    stages: ["CANDIDATE", "SPEAKER"],
    inputSchema: none,
    run: async (_input, caller) => {
      const messages = await prisma.speakerMessage.findMany({
        where: { submissionId: caller.submissionId ?? "" },
        orderBy: { createdAt: "asc" },
        take: 100,
        include: { author: { select: { name: true, accountKind: true } } },
      });
      return messages.map((m) => ({
        from: m.author.accountKind === "SPEAKER" ? "you" : "board",
        name: m.author.name,
        at: m.createdAt,
        body: m.body,
      }));
    },
  },
  {
    name: "message_board",
    description:
      "Send a message to the LOGICA board in your thread. Reference an availability window or event inline with [[window:<key>|label]] or [[event:<id>|label]] if useful.",
    stages: ["CANDIDATE", "SPEAKER"],
    inputSchema: {
      type: "object",
      required: ["body"],
      properties: { body: str("What to say. Plain text.") },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const body = String(input.body ?? "").trim();
      if (!body) fail("`body` is required.");
      if (body.length > 2000) fail("Messages are limited to 2000 characters.");
      const s = await submissionOf(caller);
      const created = await prisma.speakerMessage.create({
        data: { submissionId: s.id, authorId: caller.id, body },
      });
      return { sent: true, at: created.createdAt };
    },
  },

  // ---- Member ---------------------------------------------------------
  {
    name: "list_events",
    description: "Upcoming LOGICA events, with your RSVP status for each.",
    stages: ["MEMBER", "BOARD", "EXEC_BOARD"],
    inputSchema: none,
    run: async (_input, caller) => {
      const events = await prisma.event.findMany({
        where: { startsAt: { gte: new Date() } },
        orderBy: { startsAt: "asc" },
        take: 25,
        include: { rsvps: { where: { userId: caller.id }, select: { status: true } } },
      });
      return events.map((e) => ({
        id: e.id,
        title: e.title,
        startsAt: e.startsAt,
        location: e.location,
        myRsvp: e.rsvps[0]?.status ?? null,
      }));
    },
  },
  {
    name: "rsvp",
    description: "RSVP to a LOGICA event. Use list_events to find the event id.",
    stages: ["MEMBER", "BOARD", "EXEC_BOARD"],
    inputSchema: {
      type: "object",
      required: ["eventId", "status"],
      properties: {
        eventId: str("The event's id."),
        status: { type: "string", enum: ["GOING", "NOT_GOING"] },
      },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const eventId = String(input.eventId ?? "");
      const status = input.status === "NOT_GOING" ? "NOT_GOING" : "GOING";
      if (!(await prisma.event.findUnique({ where: { id: eventId } }))) {
        fail("No event with that id.");
      }
      await prisma.rsvp.upsert({
        where: { eventId_userId: { eventId, userId: caller.id } },
        create: { eventId, userId: caller.id, status },
        update: { status },
      });
      return { eventId, status };
    },
  },
  {
    name: "update_my_profile",
    description: "Update your own LOGICA member profile.",
    stages: ["MEMBER", "BOARD", "EXEC_BOARD"],
    inputSchema: {
      type: "object",
      properties: {
        name: str("Your full name."),
        bio: str("A short bio, up to 500 characters."),
        major: str("What you study."),
        gradYear: { type: "integer", description: "Expected graduation year." },
      },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const bio = input.bio === undefined ? undefined : String(input.bio);
      if (bio !== undefined && bio.length > 500) fail("`bio` must be 500 characters or fewer.");
      const year = input.gradYear === undefined ? undefined : Number(input.gradYear);
      if (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
        fail("`gradYear` must be a year between 1900 and 2100.");
      }
      const updated = await prisma.user.update({
        where: { id: caller.id },
        data: {
          name: input.name === undefined ? undefined : String(input.name),
          bio,
          major: input.major === undefined ? undefined : String(input.major),
          gradYear: year,
        },
        select: { name: true, bio: true, major: true, gradYear: true },
      });
      return updated;
    },
  },

  // ---- Board: run the pipeline ----------------------------------------
  {
    name: "list_guests",
    description:
      "Every speaker submission with its stage, so you can see who is waiting on a decision. Candidates who have confirmed their availability are the ones ready to decide on.",
    stages: ["BOARD", "EXEC_BOARD"],
    inputSchema: {
      type: "object",
      properties: {
        readyToDecide: {
          type: "boolean",
          description: "Only candidates who have confirmed their availability.",
        },
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const rows = await prisma.speakerSubmission.findMany({
        where: input.readyToDecide
          ? { status: "PENDING", submittedAt: { not: null }, availabilityConfirmedAt: { not: null } }
          : {},
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { event: { select: { id: true, title: true, startsAt: true } } },
      });
      return rows.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        organization: s.organization,
        stage: !s.submittedAt
          ? "DRAFT"
          : s.status === "PENDING"
            ? "CANDIDATE"
            : s.status,
        availability: s.availability ?? [],
        availabilityConfirmedAt: s.availabilityConfirmedAt,
        talkTitle: s.talkTitle,
        slidesUrl: s.slidesUrl,
        scheduledEvent: s.event,
      }));
    },
  },
  {
    name: "reply_to_guest",
    description:
      "Post a message into a candidate's or speaker's thread, as the board. Use list_guests for the submission id.",
    stages: ["BOARD", "EXEC_BOARD"],
    inputSchema: {
      type: "object",
      required: ["submissionId", "body"],
      properties: {
        submissionId: str("The submission's id."),
        body: str("What to say. Plain text."),
      },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const submissionId = String(input.submissionId ?? "");
      const body = String(input.body ?? "").trim();
      if (!body) fail("`body` is required.");
      if (body.length > 2000) fail("Messages are limited to 2000 characters.");
      const submission = await prisma.speakerSubmission.findUnique({
        where: { id: submissionId },
        select: { id: true, user: { select: { id: true } } },
      });
      if (!submission) fail("No submission with that id.");
      await prisma.speakerMessage.create({
        data: { submissionId, authorId: caller.id, body },
      });
      if (submission.user) {
        await notifyUser(submission.user.id, "The LOGICA board replied about your talk.", "announcements");
      }
      return { sent: true };
    },
  },
  {
    name: "decide_on_guest",
    description:
      "Confirm a candidate as a speaker, decline them, or move a speaker back to candidate. Confirming unlocks their talk details and event numbers.",
    stages: ["BOARD", "EXEC_BOARD"],
    inputSchema: {
      type: "object",
      required: ["submissionId", "decision"],
      properties: {
        submissionId: str("The submission's id."),
        decision: { type: "string", enum: ["CONFIRMED", "DECLINED", "PENDING"] },
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const submissionId = String(input.submissionId ?? "");
      const decision = String(input.decision ?? "");
      if (!["CONFIRMED", "DECLINED", "PENDING"].includes(decision)) {
        fail("`decision` must be CONFIRMED, DECLINED or PENDING.");
      }
      const existing = await prisma.speakerSubmission.findUnique({
        where: { id: submissionId },
        select: { id: true, user: { select: { id: true } } },
      });
      if (!existing) fail("No submission with that id.");
      const updated = await prisma.speakerSubmission.update({
        where: { id: submissionId },
        data: { status: decision as "CONFIRMED" | "DECLINED" | "PENDING" },
      });
      if (existing.user && (decision === "CONFIRMED" || decision === "DECLINED")) {
        await notifyUser(
          existing.user.id,
          decision === "CONFIRMED"
            ? "You're confirmed to speak at LOGICA @ UIC — sign in to your portal for details."
            : "Your speaker submission to LOGICA @ UIC was declined.",
          "announcements",
        );
      }
      return { submissionId, status: updated.status };
    },
  },
  {
    name: "schedule_guest",
    description:
      "Attach a scheduled event to a speaker's submission. This is what turns on the RSVP and check-in numbers on their own dashboard. Pass eventId null to unlink.",
    stages: ["BOARD", "EXEC_BOARD"],
    inputSchema: {
      type: "object",
      required: ["submissionId"],
      properties: {
        submissionId: str("The submission's id."),
        eventId: { type: ["string", "null"], description: "The event to attach, or null to unlink." },
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const submissionId = String(input.submissionId ?? "");
      const eventId = input.eventId == null ? null : String(input.eventId);
      if (eventId && !(await prisma.event.findUnique({ where: { id: eventId } }))) {
        fail("No event with that id.");
      }
      const updated = await prisma.speakerSubmission.update({
        where: { id: submissionId },
        data: { eventId },
      });
      return { submissionId, eventId: updated.eventId };
    },
  },
  {
    name: "create_event",
    description: "Put a new event on the LOGICA calendar.",
    stages: ["BOARD", "EXEC_BOARD"],
    inputSchema: {
      type: "object",
      required: ["title", "startsAt"],
      properties: {
        title: str("What the event is called."),
        startsAt: str("When it starts, as an ISO 8601 timestamp."),
        location: str("Where it is."),
        description: str("A sentence or two about it."),
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const startsAt = new Date(String(input.startsAt ?? ""));
      if (Number.isNaN(startsAt.getTime())) fail("`startsAt` must be an ISO 8601 timestamp.");
      const title = String(input.title ?? "").trim();
      if (!title) fail("`title` is required.");
      const event = await prisma.event.create({
        data: {
          title,
          startsAt,
          location: input.location === undefined ? undefined : String(input.location),
          description: input.description === undefined ? undefined : String(input.description),
        },
      });
      return { id: event.id, title: event.title, startsAt: event.startsAt };
    },
  },

  // ---- Exec board only -------------------------------------------------
  {
    name: "announce",
    description:
      "Send an announcement to every member. Exec board only — this reaches everyone's notifications and inbox, so use it sparingly.",
    stages: ["EXEC_BOARD"],
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: { message: str("The announcement. One or two sentences.") },
      additionalProperties: false,
    },
    run: async (input) => {
      const message = String(input.message ?? "").trim();
      if (!message) fail("`message` is required.");
      if (message.length > 500) fail("Announcements are limited to 500 characters.");
      const members = await prisma.user.findMany({
        where: { accountKind: "MEMBER" },
        select: { id: true },
      });
      for (const m of members) {
        await notifyUser(m.id, message, "announcements");
      }
      return { sentTo: members.length };
    },
  },
];

export function toolsFor(stage: Stage) {
  return TOOLS.filter((t) => t.stages.includes(stage));
}

/** A one-liner for the dashboard, so people know what their agent can do. */
export function toolSummary(stage: Stage) {
  return toolsFor(stage).map((t) => ({
    name: t.name,
    description: t.description,
    boardOnly: runsTheClub(stage) && !t.stages.includes("MEMBER"),
  }));
}
