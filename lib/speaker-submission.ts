/** One "I'm free this stretch of days, during this stretch of time" block. */
export type AvailabilityWindow = {
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
};

export type SpeakerFields = {
  name?: string;
  email?: string;
  organization?: string;
  referredBy?: string;
  availability?: AvailabilityWindow[];
  needs?: string;
  note?: string; // shared — either side can add context ("can't make Wednesday, works Thursday instead")
  publicOptIn?: boolean;
};

export type ParseResult =
  | { ok: true; data: SpeakerFields }
  | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function parseAvailability(value: unknown): { ok: true; windows: AvailabilityWindow[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "`availability` must be a list." };

  const windows: AvailabilityWindow[] = [];
  for (const raw of value) {
    const { startDate, endDate, startTime, endTime } = (raw ?? {}) as Record<string, unknown>;
    if (typeof startDate !== "string" || !DATE_RE.test(startDate)) {
      return { ok: false, error: "Each availability window needs a valid `startDate` (YYYY-MM-DD)." };
    }
    if (typeof endDate !== "string" || !DATE_RE.test(endDate)) {
      return { ok: false, error: "Each availability window needs a valid `endDate` (YYYY-MM-DD)." };
    }
    if (typeof startTime !== "string" || !TIME_RE.test(startTime)) {
      return { ok: false, error: "Each availability window needs a valid `startTime` (HH:MM)." };
    }
    if (typeof endTime !== "string" || !TIME_RE.test(endTime)) {
      return { ok: false, error: "Each availability window needs a valid `endTime` (HH:MM)." };
    }
    if (endDate < startDate) {
      return { ok: false, error: "`endDate` can't be before `startDate`." };
    }
    windows.push({ startDate, endDate, startTime, endTime });
  }
  return { ok: true, windows };
}

/**
 * Validates whatever subset of speaker fields is present in `payload`. Every
 * field is optional here — requiredness (e.g. "name must end up set") is a
 * caller concern, since a draft and a completed submission need different
 * rules. Pure — no I/O, easy to test.
 */
export function parseSpeakerFields(payload: unknown): ParseResult {
  const { name, email, organization, referredBy, availability, needs, note, publicOptIn } =
    (payload ?? {}) as Record<string, unknown>;

  const data: SpeakerFields = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return { ok: false, error: "`name` must be a non-empty string." };
    }
    data.name = name.trim();
  }
  if (email !== undefined) {
    if (typeof email !== "string" || !email.includes("@")) {
      return { ok: false, error: "`email` must be a valid email address." };
    }
    data.email = email.trim();
  }
  if (organization !== undefined) {
    if (typeof organization !== "string") return { ok: false, error: "`organization` must be a string." };
    data.organization = organization.trim();
  }
  if (referredBy !== undefined) {
    if (typeof referredBy !== "string") return { ok: false, error: "`referredBy` must be a string." };
    data.referredBy = referredBy.trim();
  }
  if (availability !== undefined) {
    const parsed = parseAvailability(availability);
    if (!parsed.ok) return parsed;
    data.availability = parsed.windows;
  }
  if (needs !== undefined) {
    if (typeof needs !== "string") return { ok: false, error: "`needs` must be a string." };
    data.needs = needs.trim();
  }
  if (note !== undefined) {
    if (typeof note !== "string") return { ok: false, error: "`note` must be a string." };
    data.note = note.trim();
  }
  if (publicOptIn !== undefined) {
    data.publicOptIn = publicOptIn === true;
  }

  return { ok: true, data };
}

/** Cold submit (no pre-made draft) — the whole thing arrives in one shot, so name + email are required. */
export function parseFreshSubmission(payload: unknown): ParseResult {
  const parsed = parseSpeakerFields(payload);
  if (!parsed.ok) return parsed;
  if (!parsed.data.name) return { ok: false, error: "`name` is required." };
  if (!parsed.data.email) return { ok: false, error: "`email` is required." };
  return parsed;
}

/**
 * A speaker finishing a draft a board member started. `existingName` /
 * `existingEmail` are whatever the draft already had — the payload only
 * needs to supply what's still missing.
 */
export function parseCompletion(
  payload: unknown,
  existingName: string | null,
  existingEmail: string | null,
): ParseResult {
  const parsed = parseSpeakerFields(payload);
  if (!parsed.ok) return parsed;
  if (!parsed.data.name && !existingName) {
    return { ok: false, error: "`name` is required." };
  }
  if (!parsed.data.email && !existingEmail) {
    return { ok: false, error: "`email` is required." };
  }
  return parsed;
}
