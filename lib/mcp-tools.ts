import type { BoardItemKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { parseSpeakerFields } from "@/lib/speaker-submission";
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
