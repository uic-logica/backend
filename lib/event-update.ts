import type { Prisma } from "@prisma/client";

/** A bad field in an event edit; the message is safe to show the board member. */
export class EventInputError extends Error {}

/**
 * An http(s) URL, `null` to clear it, or `undefined` when the field wasn't sent.
 * Anything else (a `javascript:` link, plain text) is refused.
 */
export function eventLink(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const raw = String(value).trim();
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {}
  throw new EventInputError("`link` must be an http or https URL.");
}

/**
 * Turns an edit request into a Prisma update. Shared by `PATCH /api/events/:id`
 * and the MCP `update_event` tool so the dashboard and agents follow one rule:
 * only the fields sent change, and an empty string clears location,
 * description or link.
 */
export function parseEventUpdate(input: Record<string, unknown>): Prisma.EventUpdateInput {
  const data: Prisma.EventUpdateInput = {};
  if (input.title !== undefined) {
    const title = String(input.title).trim();
    if (!title) throw new EventInputError("`title` can't be empty.");
    data.title = title;
  }
  if (input.startsAt !== undefined) {
    const startsAt = new Date(String(input.startsAt));
    if (Number.isNaN(startsAt.getTime())) throw new EventInputError("`startsAt` must be an ISO 8601 timestamp.");
    data.startsAt = startsAt;
  }
  for (const field of ["location", "description"] as const) {
    if (input[field] !== undefined) data[field] = input[field] === null || input[field] === "" ? null : String(input[field]);
  }
  if (input.link !== undefined) data.link = eventLink(input.link) ?? null;
  if (Object.keys(data).length === 0) throw new EventInputError("Send at least one field to change.");
  return data;
}
