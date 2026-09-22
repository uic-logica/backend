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
  talkTitle?: string;
  slidesUrl?: string; // a link, so the deck opens on whatever machine is in the room
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
  const { name, email, organization, referredBy, availability, needs, note, publicOptIn, talkTitle, slidesUrl } =
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
  if (talkTitle !== undefined) {
    if (typeof talkTitle !== "string") return { ok: false, error: "`talkTitle` must be a string." };
    if (talkTitle.length > 200) return { ok: false, error: "`talkTitle` must be 200 characters or fewer." };
    data.talkTitle = talkTitle.trim();
  }
  if (slidesUrl !== undefined) {
    if (typeof slidesUrl !== "string") return { ok: false, error: "`slidesUrl` must be a string." };
    const trimmed = slidesUrl.trim();
    // Empty clears the link. Anything else has to be a real http(s) URL —
    // this ends up as an href, so `javascript:` and friends stay out.
    if (trimmed && !/^https?:\/\/\S+$/i.test(trimmed)) {
      return { ok: false, error: "`slidesUrl` must be a link starting with http:// or https://." };
    }
    data.slidesUrl = trimmed;
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

/**
 * Where two windows overlap — same shape in, same shape out, or null when
 * they never coincide. Dates and times are both plain strings, so `max` and
 * `min` are just string comparisons.
 */
function overlap(a: AvailabilityWindow, b: AvailabilityWindow): AvailabilityWindow | null {
  const startDate = a.startDate > b.startDate ? a.startDate : b.startDate;
  const endDate = a.endDate < b.endDate ? a.endDate : b.endDate;
  const startTime = a.startTime > b.startTime ? a.startTime : b.startTime;
  const endTime = a.endTime < b.endTime ? a.endTime : b.endTime;
  if (startDate > endDate || startTime >= endTime) return null;
  return { startDate, endDate, startTime, endTime };
}

/**
 * When everyone is free at once. Pairwise intersection folded across the
 * group — one empty list means nobody has a common slot, which is the
 * answer, not an error.
 *
 * logica-lean: returns the raw intersections without merging adjacent ones
 * (Mon–Tue 9–10 and Wed 9–10 stay two rows) — revisit if a board member
 * complains about the list being long.
 */
export function commonAvailability(everyones: AvailabilityWindow[][]): AvailabilityWindow[] {
  if (everyones.length === 0) return [];
  return everyones.reduce((shared, theirs) => {
    const next: AvailabilityWindow[] = [];
    const seen = new Set<string>();
    for (const a of shared) {
      for (const b of theirs) {
        const both = overlap(a, b);
        const key = both && `${both.startDate}/${both.endDate}/${both.startTime}/${both.endTime}`;
        if (both && key && !seen.has(key)) {
          seen.add(key);
          next.push(both);
        }
      }
    }
    return next;
  });
}
