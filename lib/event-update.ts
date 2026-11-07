import type { Prisma } from "@prisma/client";
import { parseHttpLink } from "@/lib/link";

/** A bad field in an event edit; the message is safe to show the board member. */
export class EventInputError extends Error {}

/**
 * An http(s) URL, `null` to clear it, or `undefined` when the field wasn't sent.
 * Anything else (a `javascript:` link, plain text) is refused.
 */
export function eventLink(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = parseHttpLink(String(value));
  if (!parsed.ok) throw new EventInputError("`link` must be an http or https URL.");
  return parsed.url;
}

/**
 * An event picture: a URL from `POST /api/blog/images` (our own upload, so the
 * site's img-src 'self' CSP shows it), `null` to clear it, `undefined` if not sent.
 */
export function eventImage(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\/api\/blog\/images\/[a-z0-9]+$/.test(value)) {
    throw new EventInputError("`image` must be a picture uploaded from the dashboard.");
  }
  return value;
}

/**
 * Turns an edit request into a Prisma update. Shared by `PATCH /api/events/:id`
 * and the MCP `update_event` tool so the dashboard and agents follow one rule:
 * only the fields sent change, and an empty string clears location,
 * description or link.
 */
/** An event's start: an ISO 8601 timestamp, or null / "" / "TBD" for a date that isn't set yet. */
export function parseStartsAt(value: unknown): Date | null {
  if (value === null || value === "" || (typeof value === "string" && value.trim().toUpperCase() === "TBD")) return null;
  const startsAt = new Date(String(value));
  if (Number.isNaN(startsAt.getTime())) throw new EventInputError("`startsAt` must be an ISO 8601 timestamp, or null for TBD.");
  return startsAt;
}

/** An event's end: an ISO 8601 timestamp after `startsAt`, or null / "" for none. */
export function parseEndsAt(value: unknown, startsAt?: Date | null): Date | null {
  if (value === null || value === "") return null;
  const endsAt = new Date(String(value));
  if (Number.isNaN(endsAt.getTime())) throw new EventInputError("`endsAt` must be an ISO 8601 timestamp, or null for none.");
  if (startsAt && endsAt <= startsAt) throw new EventInputError("The event has to end after it starts.");
  return endsAt;
}

export function parseEventUpdate(input: Record<string, unknown>): Prisma.EventUpdateInput {
  const data: Prisma.EventUpdateInput = {};
  if (input.title !== undefined) {
    const title = String(input.title).trim();
    if (!title) throw new EventInputError("`title` can't be empty.");
    data.title = title;
  }
  if (input.startsAt !== undefined) data.startsAt = parseStartsAt(input.startsAt);
  // logica-lean: end-after-start is only checked when both are sent (the dashboard form always sends both).
  if (input.endsAt !== undefined) data.endsAt = parseEndsAt(input.endsAt, data.startsAt as Date | null | undefined);
  // No date means no end time either.
  if (data.startsAt === null) data.endsAt = null;
  for (const field of ["location", "description"] as const) {
    if (input[field] !== undefined) data[field] = input[field] === null || input[field] === "" ? null : String(input[field]);
  }
  if (input.link !== undefined) data.link = eventLink(input.link) ?? null;
  if (input.image !== undefined) data.image = eventImage(input.image) ?? null;
  if (Object.keys(data).length === 0) throw new EventInputError("Send at least one field to change.");
  return data;
}
