import type { BoardItemKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { type AvailabilityWindow, commonAvailability, parseSpeakerFields } from "@/lib/speaker-submission";
import { type Caller } from "@/lib/mcp-token";
import { type Stage, STAGE_LABELS, runsTheClub } from "@/lib/stage";
import {
  budgetRollup,
  parseBoardItem,
  STAGES,
  STAGE_LABELS as BOARD_STAGE_LABELS,
  validStage,
} from "@/lib/board-item";
import { clubInsights } from "@/lib/insights";
import { mintInvite, isVisitKind, VISIT_NOUN } from "@/lib/invite";
import { CHECK_IN_CODE_MINUTES, checkCode, generateCheckInCode, normalizeCheckInCode } from "@/lib/check-in";
import { driveConfigured, FOLDER_MIME, listFolder, searchFiles } from "@/lib/drive";

type Json = Record<string, unknown>;

export type Tool = {
  name: string;
  description: string;
  /** Which of the five see this tool at all. */
  stages: Stage[];
  inputSchema: Json;
  run: (input: Json, caller: Caller) => Promise<unknown>;
};

/**
 * Who sees the club-running tools. Exec only for now — BOARD sees the
 * member view until it gets its own surface, and an agent must not be a
 * way around that. Mirrors runsWorkspace() in lib/authz.ts.
 */
const WORKSPACE: Stage[] = ["EXEC_BOARD"];

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

function boardKind(value: unknown): BoardItemKind {
  const kind = String(value ?? "").toUpperCase();
  if (kind !== "MONEY" && kind !== "OUTREACH") fail("`kind` must be MONEY or OUTREACH.");
  return kind;
}

/**
 * Same validation the HTTP routes use, with the thrown message turned into
 * something the agent can act on rather than a 400.
 */
function parseOrFail(input: Json, kind: BoardItemKind, creating: boolean) {
  try {
    return parseBoardItem(input, kind, { creating });
  } catch (error) {
    fail((error as Error).message);
  }
}

/** Agents reason about "$12.50" far better than about 1250. */
function money(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return `$${(cents / 100).toFixed(2)}`;
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
    stages: WORKSPACE,
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
    name: "common_slots",
    description:
      "When two or more guests are all free at once — the overlap of their availability windows, the same thing the calendar grid shows a person. Pass submission ids from list_guests. An empty list means there is no time that works for everyone.",
    stages: WORKSPACE,
    inputSchema: {
      type: "object",
      required: ["guestIds"],
      properties: {
        guestIds: {
          type: "array",
          description: "Submission ids to intersect, from list_guests.",
          items: str("A submission id"),
        },
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const ids = Array.isArray(input.guestIds) ? input.guestIds.map(String) : fail("`guestIds` must be a list of submission ids.");
      if (ids.length === 0) fail("Give at least one submission id.");
      const rows = await prisma.speakerSubmission.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, availability: true, availabilityConfirmedAt: true },
      });
      const missing = ids.filter((id) => !rows.some((r) => r.id === id));
      if (missing.length) fail(`No submission with id ${missing.join(", ")}.`);

      const guests = rows.map((r) => {
        const parsed = parseSpeakerFields({ availability: r.availability ?? [] });
        return {
          id: r.id,
          name: r.name,
          // Unconfirmed windows still count — they are the best guess we have,
          // and the caller is told which ones are not final yet.
          confirmed: r.availabilityConfirmedAt !== null,
          windows: parsed.ok ? (parsed.data.availability ?? []) : ([] as AvailabilityWindow[]),
        };
      });
      const shared = commonAvailability(guests.map((g) => g.windows));
      return {
        guests: guests.map(({ windows, ...g }) => ({ ...g, windowCount: windows.length })),
        shared,
        note: shared.length
          ? "Times are Chicago local. Use schedule_guest once you pick one."
          : "Nothing overlaps — ask someone in their thread for more windows (reply_to_guest).",
      };
    },
  },
  {
    name: "reply_to_guest",
    description:
      "Post a message into a candidate's or speaker's thread, as the board. Use list_guests for the submission id.",
    stages: WORKSPACE,
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
    stages: WORKSPACE,
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
    stages: WORKSPACE,
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
    stages: WORKSPACE,
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

  // ---- Board: the two pipelines, money and outreach --------------------
  //
  // These are why the board dashboard has an MCP surface at all: the
  // treasurer wants to say "log forty dollars of pizza for the Aon visit"
  // rather than open a form, and the outreach lead wants to say "who still
  // owes a reply". Same table, same rules, same validation as the HTTP
  // routes — everything routes through lib/board-item.ts.
  {
    name: "list_board_items",
    description:
      "List what the board is tracking — spending (MONEY) or companies and guests we're talking to (OUTREACH). Filter by stage, or by what's assigned to you.",
    stages: WORKSPACE,
    inputSchema: {
      type: "object",
      properties: {
        kind: str("MONEY or OUTREACH. Leave out for both."),
        stage: str("Only items at this stage. See whoami or omit to see all."),
        mine: { type: "boolean", description: "Only items you own." },
        includeArchived: { type: "boolean", description: "Include archived items." },
      },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const kind = input.kind === undefined ? undefined : boardKind(input.kind);
      const stage = input.stage === undefined ? undefined : String(input.stage).toUpperCase();
      if (stage && kind && !validStage(kind, stage)) {
        fail(`"${stage}" isn't a stage for ${kind}. Use one of: ${STAGES[kind].join(", ")}.`);
      }
      const items = await prisma.boardItem.findMany({
        where: {
          ...(kind ? { kind } : {}),
          ...(stage ? { stage } : {}),
          ...(input.mine === true ? { ownerId: caller.id } : {}),
          ...(input.includeArchived === true ? {} : { archivedAt: null }),
        },
        orderBy: [{ nextStepAt: "asc" }, { updatedAt: "desc" }],
        take: 200,
        include: {
          owner: { select: { name: true, email: true } },
          event: { select: { title: true, startsAt: true } },
          budget: { select: { label: true } },
        },
      });
      return items.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        stage: item.stage,
        stageLabel: BOARD_STAGE_LABELS[item.stage] ?? item.stage,
        detail: item.detail,
        owner: item.owner?.name ?? item.owner?.email ?? null,
        nextStepAt: item.nextStepAt,
        archived: item.archivedAt !== null,
        ...(item.kind === "MONEY"
          ? {
              amount: money(item.amountCents),
              budget: item.budget?.label ?? "unbudgeted",
              fronted: item.paidByUserId !== null,
              receiptUrl: item.receiptUrl,
            }
          : {
              org: item.org,
              contact: item.contactName,
              contactEmail: item.contactEmail,
              channel: item.channel,
              category: item.category,
              link: item.link,
              lastTouchAt: item.lastTouchAt,
            }),
        event: item.event?.title ?? null,
      }));
    },
  },

  {
    name: "add_board_item",
    description:
      "Track something new. MONEY for a cost the club is about to incur or has paid; OUTREACH for a company, speaker or partner we want to talk to. Amounts are whole cents.",
    stages: WORKSPACE,
    inputSchema: {
      type: "object",
      required: ["kind", "title"],
      properties: {
        kind: str("MONEY or OUTREACH."),
        title: str("What it is. 'Pizza for the Aon visit', 'Zebra — workshop'."),
        detail: str("Anything else worth knowing."),
        stage: str("Where it starts. Defaults to REQUESTED (money) or PROSPECT (outreach)."),
        nextStepAt: str("When the next move is due, ISO 8601."),
        // Money
        amountCents: { type: "integer", description: "Whole cents. $12.50 is 1250." },
        paidByUserId: str("If a person fronted this out of pocket, their user id — it then shows as owed back to them."),
        receiptUrl: str("Link to the receipt. http(s) only."),
        // Outreach
        org: str("Company or organisation name."),
        contactName: str("Who we're talking to there."),
        contactEmail: str("Their email."),
        channel: str("How we reached them: LinkedIn, email, in person, a referral."),
        category: str("Company visit, talk, workshop or partner."),
        link: str("LinkedIn profile or thread link. http(s) only."),
      },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const kind = boardKind(input.kind);
      const data = parseOrFail(input, kind, true);
      const item = await prisma.boardItem.create({
        data: {
          ...(data as Prisma.BoardItemUncheckedCreateInput),
          kind,
          createdById: caller.id,
          stageChangedById: caller.id,
          stageChangedAt: new Date(),
        },
      });
      return { id: item.id, kind: item.kind, title: item.title, stage: item.stage };
    },
  },

  {
    name: "update_board_item",
    description:
      "Move something along — approve a spend, mark that a company replied, hand it to someone else, or set when the next move is due.",
    stages: WORKSPACE,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: str("The item's id, from list_board_items."),
        stage: str("Its new stage."),
        title: str("Rename it."),
        detail: str("Replace the notes."),
        ownerId: str("Hand it to this user id."),
        nextStepAt: str("When the next move is due, ISO 8601. Empty string clears it."),
        amountCents: { type: "integer", description: "Whole cents (money items)." },
        receiptUrl: str("Link to the receipt (money items)."),
        contactName: str("Who we're talking to (outreach items)."),
        contactEmail: str("Their email (outreach items)."),
        channel: str("How we reached them (outreach items)."),
        lastTouchAt: str("When we last spoke to them, ISO 8601 (outreach items)."),
        archive: { type: "boolean", description: "Archive it (true) or bring it back (false)." },
      },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const id = String(input.id ?? "").trim();
      if (!id) fail("`id` is required.");
      const existing = await prisma.boardItem.findUnique({
        where: { id },
        select: { kind: true, stage: true },
      });
      if (!existing) fail("No item with that id.");

      const data = parseOrFail(input, existing.kind, false);
      const movedStage = typeof data.stage === "string" && data.stage !== existing.stage;

      const item = await prisma.boardItem.update({
        where: { id },
        data: {
          ...(data as Prisma.BoardItemUncheckedUpdateInput),
          ...(movedStage ? { stageChangedById: caller.id, stageChangedAt: new Date() } : {}),
          ...(input.archive === true ? { archivedAt: new Date() } : {}),
          ...(input.archive === false ? { archivedAt: null } : {}),
        },
      });
      return {
        id: item.id,
        title: item.title,
        stage: item.stage,
        stageLabel: BOARD_STAGE_LABELS[item.stage] ?? item.stage,
        movedStage,
      };
    },
  },

  {
    name: "budget_status",
    description:
      "What's left in the club's budget, what's waiting on approval, and who is owed money back out of their own pocket.",
    stages: WORKSPACE,
    inputSchema: none,
    run: async () => {
      const budgets = await prisma.budget.findMany({
        orderBy: { startsAt: "desc" },
        include: {
          items: {
            where: { archivedAt: null },
            select: { stage: true, amountCents: true, paidByUserId: true },
          },
        },
      });

      const awaitingApproval = await prisma.boardItem.findMany({
        where: { kind: "MONEY", stage: "REQUESTED", archivedAt: null },
        select: { id: true, title: true, amountCents: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });

      const owedBack = await prisma.boardItem.findMany({
        where: {
          kind: "MONEY",
          archivedAt: null,
          NOT: [{ paidByUserId: null }, { stage: "REIMBURSED" }, { stage: "DECLINED" }],
        },
        select: {
          id: true,
          title: true,
          amountCents: true,
          paidBy: { select: { name: true, email: true } },
        },
      });

      // Spends filed under no budget still left the account. Reporting only
      // the budgets would tell the treasurer they have more than they do.
      const loose = await prisma.boardItem.findMany({
        where: { kind: "MONEY", budgetId: null, archivedAt: null },
        select: { stage: true, amountCents: true, paidByUserId: true },
      });
      const looseRoll = budgetRollup(0, loose);

      return {
        budgets: budgets.map((budget) => {
          const roll = budgetRollup(budget.amountCents, budget.items);
          return {
            label: budget.label,
            total: money(roll.amountCents),
            spent: money(roll.spentCents),
            awaitingOrApproved: money(roll.pendingCents),
            left: money(roll.remainingCents),
            overspent: roll.remainingCents < 0,
          };
        }),
        unbudgeted: {
          count: loose.length,
          spent: money(looseRoll.spentCents),
          awaitingOrApproved: money(looseRoll.pendingCents),
        },
        awaitingApproval: awaitingApproval.map((i) => ({
          id: i.id,
          title: i.title,
          amount: money(i.amountCents),
          waitingSince: i.createdAt,
        })),
        owedBack: owedBack.map((i) => ({
          id: i.id,
          title: i.title,
          amount: money(i.amountCents),
          to: i.paidBy?.name ?? i.paidBy?.email ?? "someone",
        })),
      };
    },
  },

  {
    name: "club_insights",
    description:
      "How the club is actually doing: how many members, how many are still turning up, which events landed, and who comes to everything.",
    stages: WORKSPACE,
    inputSchema: none,
    run: async () => {
      const data = await clubInsights();
      return {
        ...data,
        // Spelled out so an agent reads it right rather than guessing.
        note: `"Active" means checked in to at least one event in the last ${data.members.activeWindowDays} days. showRate is attended / said-they'd-come, as a percentage; null means nobody RSVP'd.`,
      };
    },
  },

  {
    name: "find_documents",
    description:
      "Search the club's Google Drive by file name — the constitution, budgets, decks, run-of-shows. Returns links, not file contents.",
    stages: WORKSPACE,
    inputSchema: {
      type: "object",
      properties: {
        query: str("Part of the file name. Leave out to list the top-level folder."),
      },
      additionalProperties: false,
    },
    run: async (input) => {
      if (!driveConfigured()) {
        fail("Google Drive isn't connected yet — an exec needs to add the service account in the dashboard settings.");
      }
      const query = input.query === undefined ? "" : String(input.query).trim();
      const files = query ? await searchFiles(query) : await listFolder();
      return files.slice(0, 50).map((file) => ({
        name: file.name,
        isFolder: file.mimeType === FOLDER_MIME,
        link: file.webViewLink ?? null,
        modified: file.modifiedTime ?? null,
        owner: file.owners?.[0]?.displayName ?? null,
        folderId: file.mimeType === FOLDER_MIME ? file.id : null,
      }));
    },
  },


  // ---- Everyone: what the platform is telling you ---------------------
  {
    name: "my_notifications",
    description:
      "Your LOGICA notifications, newest first — event reminders, board decisions, announcements. Says which are unread.",
    stages: ["CANDIDATE", "SPEAKER", "MEMBER", "BOARD", "EXEC_BOARD"],
    inputSchema: {
      type: "object",
      properties: { unreadOnly: { type: "boolean", description: "Only the ones you haven't read." } },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const rows = await prisma.notification.findMany({
        where: { userId: caller.id, ...(input.unreadOnly === true ? { readAt: null } : {}) },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return {
        unread: rows.filter((n) => !n.readAt).length,
        notifications: rows.map((n) => ({ id: n.id, message: n.message, at: n.createdAt, read: n.readAt !== null })),
      };
    },
  },
  {
    name: "mark_notification_read",
    description: "Mark one of your notifications as read, or all of them.",
    stages: ["CANDIDATE", "SPEAKER", "MEMBER", "BOARD", "EXEC_BOARD"],
    inputSchema: {
      type: "object",
      properties: {
        id: str("The notification's id. Leave out and set all:true to clear everything."),
        all: { type: "boolean", description: "Mark every unread notification read." },
      },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      if (input.all === true) {
        // Scoped to the caller — a notification id alone must never be
        // enough to touch someone else's row.
        const r = await prisma.notification.updateMany({
          where: { userId: caller.id, readAt: null },
          data: { readAt: new Date() },
        });
        return { markedRead: r.count };
      }
      const id = String(input.id ?? "").trim();
      if (!id) fail("Pass an `id`, or `all: true`.");
      const r = await prisma.notification.updateMany({
        where: { id, userId: caller.id },
        data: { readAt: new Date() },
      });
      if (r.count === 0) fail("No unread notification of yours with that id.");
      return { markedRead: r.count };
    },
  },

  // ---- Members: turning up, and the feed -------------------------------
  {
    name: "check_in",
    description:
      "Check in to an event you're at, using the code the organiser puts up. This is what counts as attendance — an RSVP on its own doesn't.",
    stages: ["MEMBER", "BOARD", "EXEC_BOARD"],
    inputSchema: {
      type: "object",
      required: ["code"],
      properties: { code: str("The check-in code shown at the event.") },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const submitted = String(input.code ?? "").trim();
      if (!submitted) fail("`code` is required.");
      // Same normalisation the door flow uses, so "abc-234" matches "ABC234".
      const row = await prisma.checkInCode.findFirst({
        where: { code: normalizeCheckInCode(submitted) },
        include: { event: { select: { id: true, title: true, startsAt: true } } },
      });
      const verdict = checkCode(row, submitted);
      if (verdict !== "ok") {
        fail(
          verdict === "expired"
            ? "That code has expired — ask the organiser to open check-in again."
            : "That code isn't valid. Check it, or ask the organiser.",
        );
      }
      if (!row) fail("That code isn't valid.");
      const existing = await prisma.attendance.findUnique({
        where: { eventId_userId: { eventId: row.eventId, userId: caller.id } },
      });
      if (existing) return { alreadyCheckedIn: true, event: row.event.title, at: existing.checkedInAt };
      await prisma.attendance.create({ data: { eventId: row.eventId, userId: caller.id } });
      return { checkedIn: true, event: row.event.title, startsAt: row.event.startsAt };
    },
  },
  {
    name: "my_engagement",
    description: "How involved you've been: events attended, posts made, forms submitted.",
    stages: ["MEMBER", "BOARD", "EXEC_BOARD"],
    inputSchema: none,
    run: async (_input, caller) => {
      const [attended, posts, submissions, recent] = await Promise.all([
        prisma.attendance.count({ where: { userId: caller.id } }),
        prisma.post.count({ where: { authorId: caller.id } }),
        prisma.submission.count({ where: { userId: caller.id } }),
        prisma.attendance.findMany({
          where: { userId: caller.id },
          orderBy: { checkedInAt: "desc" },
          take: 5,
          select: { checkedInAt: true, event: { select: { title: true } } },
        }),
      ]);
      return {
        eventsAttended: attended,
        postsMade: posts,
        formsSubmitted: submissions,
        recentlyAttended: recent.map((a) => ({ event: a.event.title, at: a.checkedInAt })),
      };
    },
  },
  {
    name: "read_feed",
    description: "The club's community feed, newest first.",
    stages: ["MEMBER", "BOARD", "EXEC_BOARD"],
    inputSchema: none,
    run: async () => {
      const posts = await prisma.post.findMany({
        where: { eventId: null },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { author: { select: { name: true } } },
      });
      return posts.map((p) => ({ by: p.author.name, body: p.body, at: p.createdAt }));
    },
  },
  {
    name: "post_to_feed",
    description: "Post to the club's community feed. Everyone signed in can read it.",
    stages: ["MEMBER", "BOARD", "EXEC_BOARD"],
    inputSchema: {
      type: "object",
      required: ["body"],
      properties: { body: str("What to post.") },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const body = String(input.body ?? "").trim();
      if (!body) fail("`body` is required.");
      if (body.length > 2000) fail("Posts are limited to 2000 characters.");
      const post = await prisma.post.create({ data: { authorId: caller.id, body } });
      return { id: post.id, at: post.createdAt };
    },
  },

  // ---- Guests: the bit set_talk doesn't cover --------------------------
  {
    name: "set_my_needs",
    description:
      "What you need in the room — projector, HDMI, a mic, dietary requirements, anything. Also takes a note for the board.",
    stages: ["CANDIDATE", "SPEAKER"],
    inputSchema: {
      type: "object",
      properties: {
        needs: str("Equipment or setup you need. Replaces whatever is on file."),
        note: str("Anything else the board should know."),
      },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const s = await submissionOf(caller);
      if (input.needs === undefined && input.note === undefined) fail("Pass `needs`, `note`, or both.");
      const updated = await prisma.speakerSubmission.update({
        where: { id: s.id },
        data: {
          ...(input.needs === undefined ? {} : { needs: String(input.needs).slice(0, 2000) }),
          ...(input.note === undefined ? {} : { note: String(input.note).slice(0, 2000) }),
        },
      });
      return { needs: updated.needs, note: updated.note, visit: VISIT_NOUN[updated.kind] };
    },
  },

  // ---- Exec: bringing guests in ----------------------------------------
  {
    name: "invite_guest",
    description:
      "Start a guest and get a single-use sign-up link to send them. They click it, pick an email and a password, and they're in their own dashboard — no second step from you. Returns the link ONCE; it can't be recovered, only replaced.",
    stages: WORKSPACE,
    inputSchema: {
      type: "object",
      properties: {
        name: str("Their name, if you know it."),
        email: str("Their email, if you know it. They can change it."),
        organization: str("Where they're from."),
        referredBy: str("Who put us on to them."),
        kind: str("What we're asking for: TALK, WORKSHOP or COMPANY_VISIT. Defaults to TALK."),
        submissionId: str("An existing guest's id, to replace their link instead of creating a new guest."),
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const { secret, ...invite } = mintInvite();

      if (input.submissionId) {
        const id = String(input.submissionId);
        const existing = await prisma.speakerSubmission.findUnique({
          where: { id },
          select: { id: true, name: true, user: { select: { id: true } } },
        });
        if (!existing) fail("No guest with that id.");
        if (existing.user) fail("They already have an account — a new link would have nothing to do.");
        await prisma.speakerSubmission.update({ where: { id }, data: invite });
        return {
          submissionId: id,
          name: existing.name,
          inviteToken: secret,
          expiresAt: invite.inviteExpiresAt,
          note: "The previous link stopped working. Send this one instead.",
        };
      }

      const kind = input.kind === undefined ? "TALK" : String(input.kind).toUpperCase();
      if (!isVisitKind(kind)) fail("`kind` must be TALK, WORKSHOP or COMPANY_VISIT.");
      const parsed = parseSpeakerFields({
        name: input.name,
        email: input.email,
        organization: input.organization,
        referredBy: input.referredBy,
      });
      if (!parsed.ok) fail(parsed.error);

      const draft = await prisma.speakerSubmission.create({ data: { ...parsed.data, kind, ...invite } });
      return {
        submissionId: draft.id,
        name: draft.name,
        kind,
        inviteToken: secret,
        expiresAt: invite.inviteExpiresAt,
        note: "Build the link as <site>/invite/<inviteToken> and send it. Shown once — only a hash is stored.",
      };
    },
  },

  // ---- Exec: the club's people -----------------------------------------
  {
    name: "list_members",
    description:
      "The club roster: who's here, what they study, how much they've turned up, and what they are on the board.",
    stages: WORKSPACE,
    inputSchema: {
      type: "object",
      properties: {
        search: str("Filter by name, email or major."),
        boardOnly: { type: "boolean", description: "Only board and exec." },
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const q = input.search === undefined ? "" : String(input.search).trim();
      const rows = await prisma.user.findMany({
        where: {
          accountKind: "MEMBER",
          ...(input.boardOnly === true ? { NOT: { role: "MEMBER" } } : {}),
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { email: { contains: q, mode: "insensitive" } },
                  { major: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: [{ role: "desc" }, { name: "asc" }],
        take: 200,
        select: {
          id: true, name: true, email: true, role: true, officer: true,
          major: true, gradYear: true, _count: { select: { attendances: true } },
        },
      });
      return rows.map(({ _count, ...m }) => ({ ...m, eventsAttended: _count.attendances }));
    },
  },
  {
    name: "set_member_role",
    description:
      "Change what someone is on the board. Role decides access; officer only decides what gets pinned on their dashboard.",
    stages: ["EXEC_BOARD"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: str("Their user id, from list_members."),
        role: str("MEMBER, BOARD or EXEC_BOARD."),
        officer: str("PRESIDENT, VICE_PRESIDENT, TREASURER, SECRETARY, OUTREACH, OTHER, or empty to clear."),
      },
      additionalProperties: false,
    },
    run: async (input, caller) => {
      const id = String(input.id ?? "").trim();
      if (!id) fail("`id` is required.");
      const target = await prisma.user.findUnique({ where: { id }, select: { id: true, accountKind: true } });
      if (!target || target.accountKind !== "MEMBER") fail("No member with that id.");

      const data: Record<string, unknown> = {};
      if (input.role !== undefined) {
        const role = String(input.role).toUpperCase();
        if (!["MEMBER", "BOARD", "EXEC_BOARD"].includes(role)) fail("`role` must be MEMBER, BOARD or EXEC_BOARD.");
        // Same guard as the HTTP route: nobody removes themselves from the
        // only seat that can put them back.
        if (id === caller.id && role !== "EXEC_BOARD") {
          fail("You can't take yourself off the exec board — ask another exec.");
        }
        data.role = role;
      }
      if (input.officer !== undefined) {
        const officer = String(input.officer).toUpperCase();
        if (officer === "") data.officer = null;
        else if (!["PRESIDENT", "VICE_PRESIDENT", "TREASURER", "SECRETARY", "OUTREACH", "OTHER"].includes(officer)) {
          fail("`officer` must be PRESIDENT, VICE_PRESIDENT, TREASURER, SECRETARY, OUTREACH, OTHER, or empty.");
        } else data.officer = officer;
      }
      if (Object.keys(data).length === 0) fail("Pass `role`, `officer`, or both.");

      const updated = await prisma.user.update({
        where: { id },
        data,
        select: { id: true, name: true, email: true, role: true, officer: true },
      });
      return updated;
    },
  },

  // ---- Exec: money and events ------------------------------------------
  {
    name: "set_budget",
    description:
      "Create a budget for a term. Costs filed against it draw it down; what's left is worked out on the fly, never stored.",
    stages: ["EXEC_BOARD"],
    inputSchema: {
      type: "object",
      required: ["label", "amountCents", "startsAt", "endsAt"],
      properties: {
        label: str('What to call it, e.g. "Fall 2026".'),
        amountCents: { type: "integer", description: "Whole cents. $4,000 is 400000." },
        startsAt: str("When the term starts, ISO 8601 or YYYY-MM-DD."),
        endsAt: str("When it ends."),
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const label = String(input.label ?? "").trim();
      if (!label) fail("`label` is required.");
      const amountCents = Number(input.amountCents);
      if (!Number.isInteger(amountCents) || amountCents < 0) fail("`amountCents` must be whole cents, not negative.");
      const startsAt = new Date(String(input.startsAt ?? ""));
      const endsAt = new Date(String(input.endsAt ?? ""));
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) fail("Dates must be ISO 8601 or YYYY-MM-DD.");
      if (endsAt <= startsAt) fail("The term has to end after it starts.");
      const b = await prisma.budget.create({ data: { label: label.slice(0, 120), amountCents, startsAt, endsAt } });
      return { id: b.id, label: b.label, total: money(b.amountCents), startsAt: b.startsAt, endsAt: b.endsAt };
    },
  },
  {
    name: "open_check_in",
    description:
      "Open check-in for an event and get the code to read out. Members use it with check_in; that's what counts as attendance.",
    stages: WORKSPACE,
    inputSchema: {
      type: "object",
      required: ["eventId"],
      properties: { eventId: str("The event's id, from list_events.") },
      additionalProperties: false,
    },
    run: async (input) => {
      const eventId = String(input.eventId ?? "").trim();
      const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, title: true } });
      if (!event) fail("No event with that id.");
      const code = generateCheckInCode();
      const expiresAt = new Date(Date.now() + CHECK_IN_CODE_MINUTES * 60 * 1000);
      await prisma.checkInCode.upsert({
        where: { eventId },
        create: { eventId, code, expiresAt },
        update: { code, expiresAt },
      });
      return { event: event.title, code, expiresAt, note: "Read this out at the event. It expires on its own." };
    },
  },
  {
    name: "event_attendance",
    description: "Who said they were coming to an event and who actually turned up.",
    stages: WORKSPACE,
    inputSchema: {
      type: "object",
      required: ["eventId"],
      properties: { eventId: str("The event's id.") },
      additionalProperties: false,
    },
    run: async (input) => {
      const eventId = String(input.eventId ?? "").trim();
      const event = await prisma.event.findUnique({ where: { id: eventId }, select: { title: true } });
      if (!event) fail("No event with that id.");
      const [going, came] = await Promise.all([
        prisma.rsvp.findMany({
          where: { eventId, status: "GOING" },
          select: { user: { select: { name: true, email: true } } },
        }),
        prisma.attendance.findMany({
          where: { eventId },
          select: { checkedInAt: true, user: { select: { name: true, email: true } } },
        }),
      ]);
      const cameEmails = new Set(came.map((a) => a.user.email));
      return {
        event: event.title,
        saidTheydCome: going.length,
        turnedUp: came.length,
        showRate: going.length ? Math.round((came.length / going.length) * 100) : null,
        noShows: going.filter((r) => !cameEmails.has(r.user.email)).map((r) => r.user.name ?? r.user.email),
        attendees: came.map((a) => ({ who: a.user.name ?? a.user.email, at: a.checkedInAt })),
      };
    },
  },

  // ---- Exec: people asking to join --------------------------------------
  {
    name: "list_applications",
    description: "People who applied to join the club, and where each one got to.",
    stages: WORKSPACE,
    inputSchema: {
      type: "object",
      properties: { pendingOnly: { type: "boolean", description: "Only the ones nobody has decided on." } },
      additionalProperties: false,
    },
    run: async (input) => {
      const rows = await prisma.membershipApplication.findMany({
        where: input.pendingOnly === true ? { status: "PENDING" } : {},
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return rows.map((a) => ({
        id: a.id, name: a.name, email: a.email, track: a.track,
        major: a.major, gradYear: a.gradYear, why: a.why, status: a.status, at: a.createdAt,
      }));
    },
  },
  {
    name: "decide_on_application",
    description: "Accept, decline, or move a membership application to interview.",
    stages: WORKSPACE,
    inputSchema: {
      type: "object",
      required: ["id", "decision"],
      properties: {
        id: str("The application's id, from list_applications."),
        decision: str("PENDING, INTERVIEW, ACCEPTED or DECLINED."),
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const id = String(input.id ?? "").trim();
      const decision = String(input.decision ?? "").toUpperCase();
      if (!["PENDING", "INTERVIEW", "ACCEPTED", "DECLINED"].includes(decision)) {
        fail("`decision` must be PENDING, INTERVIEW, ACCEPTED or DECLINED.");
      }
      const existing = await prisma.membershipApplication.findUnique({ where: { id }, select: { id: true } });
      if (!existing) fail("No application with that id.");
      const updated = await prisma.membershipApplication.update({
        where: { id },
        data: { status: decision as "PENDING" | "INTERVIEW" | "ACCEPTED" | "DECLINED" },
        select: { id: true, name: true, email: true, status: true },
      });
      return updated;
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
