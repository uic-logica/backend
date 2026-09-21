import type { BoardItemKind } from "@prisma/client";

/**
 * The two pipelines the board runs, and the only file that knows a spend
 * differs from a company we're talking to. Everything else — the routes, the
 * MCP tools, the UI — treats a BoardItem as one shape.
 *
 * Order matters: it is the order the stages appear in the UI, and it reads
 * left to right as the thing progresses. The last stage of each list is the
 * "didn't happen" one.
 */
export const STAGES = {
  MONEY: ["REQUESTED", "APPROVED", "PAID", "REIMBURSED", "DECLINED"],
  OUTREACH: [
    "PROSPECT",
    "CONTACTED",
    "NEEDS_REPLY",
    "REPLIED",
    "SCHEDULED",
    "DONE",
    "PASSED",
  ],
} as const satisfies Record<BoardItemKind, readonly string[]>;

export const STAGE_LABELS: Record<string, string> = {
  // Money
  REQUESTED: "Requested",
  APPROVED: "Approved",
  PAID: "Paid",
  REIMBURSED: "Paid back",
  DECLINED: "Declined",
  // Outreach
  PROSPECT: "Prospect",
  CONTACTED: "Reached out",
  NEEDS_REPLY: "Needs a reply",
  REPLIED: "We replied",
  SCHEDULED: "Scheduled",
  DONE: "Done",
  PASSED: "Passed",
};

/** Where a brand-new item of each kind starts. */
export const FIRST_STAGE: Record<BoardItemKind, string> = {
  MONEY: "REQUESTED",
  OUTREACH: "PROSPECT",
};

export function validStage(kind: BoardItemKind, stage: string): boolean {
  return (STAGES[kind] as readonly string[]).includes(stage);
}

/** Money that has actually left the club's account. */
const SPENT_STAGES = ["PAID", "REIMBURSED"];
/** Money committed but not yet out the door. */
const PENDING_STAGES = ["REQUESTED", "APPROVED"];

export type RollupItem = {
  stage: string;
  amountCents: number | null;
  paidByUserId?: string | null;
};

export type Rollup = {
  amountCents: number;
  spentCents: number;
  pendingCents: number;
  remainingCents: number;
  owedBackCents: number;
};

/**
 * What a budget actually has left. Never stored — a corrected amount or a
 * reversed approval would leave a stale balance behind, and the treasurer
 * would have no way to tell.
 *
 * `remaining` subtracts pending as well as spent, because money the board has
 * already approved is not money it can spend twice. `owedBack` is the
 * reimbursement queue: someone fronted it and hasn't been paid back yet.
 */
export function budgetRollup(
  amountCents: number,
  items: readonly RollupItem[],
): Rollup {
  const sum = (stages: string[]) =>
    items
      .filter((i) => stages.includes(i.stage))
      .reduce((total, i) => total + (i.amountCents ?? 0), 0);

  const spentCents = sum(SPENT_STAGES);
  const pendingCents = sum(PENDING_STAGES);
  const owedBackCents = items
    .filter((i) => i.paidByUserId && i.stage !== "REIMBURSED" && i.stage !== "DECLINED")
    .reduce((total, i) => total + (i.amountCents ?? 0), 0);

  return {
    amountCents,
    spentCents,
    pendingCents,
    remainingCents: amountCents - spentCents - pendingCents,
    owedBackCents,
  };
}

/** Trim to null so an empty form field clears the column instead of storing "". */
function text(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function when(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("That date isn't a real date.");
  return date;
}

/**
 * Only http(s) links. A `javascript:` receipt URL would otherwise be stored
 * and later rendered as an anchor the whole board clicks.
 */
function link(value: unknown): string | null | undefined {
  const raw = text(value, 2000);
  if (raw === undefined || raw === null) return raw;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("That link isn't a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Links have to start with http:// or https://.");
  }
  return parsed.toString();
}

function cents(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error("Amounts are whole cents — 12.50 dollars is 1250.");
  }
  if (n < 0) throw new Error("Amounts can't be negative.");
  if (n > 100_000_000) throw new Error("That amount is too large.");
  return n;
}

export type ParsedItem = Record<string, unknown>;

/**
 * Validate a create/update body into Prisma data. Fields left out of `body`
 * stay `undefined` and Prisma skips them, so a PATCH only touches what was
 * sent. Throws a message meant to be shown to the person.
 */
export function parseBoardItem(
  body: Record<string, unknown>,
  kind: BoardItemKind,
  { creating }: { creating: boolean },
): ParsedItem {
  const title = text(body.title, 200);
  if (creating && !title) throw new Error("Give it a title.");
  if (title === null) throw new Error("Give it a title.");

  let stage = text(body.stage, 40);
  if (stage) {
    stage = stage.toUpperCase();
    if (!validStage(kind, stage)) {
      throw new Error(
        `"${stage}" isn't a stage for this. Use one of: ${STAGES[kind].join(", ")}.`,
      );
    }
  } else if (creating) {
    stage = FIRST_STAGE[kind];
  } else {
    stage = undefined;
  }

  const data: ParsedItem = {
    title,
    stage,
    detail: text(body.detail, 5000),
    ownerId: text(body.ownerId, 60),
    nextStepAt: when(body.nextStepAt),
  };

  if (kind === "MONEY") {
    data.amountCents = cents(body.amountCents);
    data.budgetId = text(body.budgetId, 60);
    data.paidByUserId = text(body.paidByUserId, 60);
    data.receiptUrl = link(body.receiptUrl);
  } else {
    data.org = text(body.org, 200);
    data.contactName = text(body.contactName, 200);
    data.contactEmail = text(body.contactEmail, 320);
    data.channel = text(body.channel, 60);
    data.category = text(body.category, 60);
    data.link = link(body.link);
    data.lastTouchAt = when(body.lastTouchAt);
  }

  data.eventId = text(body.eventId, 60);
  return data;
}
