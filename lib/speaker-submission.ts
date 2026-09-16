export type ParsedSpeakerSubmission = {
  name: string;
  email: string;
  organization: string | null;
  referredBy: string;
  availability: Date[];
  needs: string | null;
  publicOptIn: boolean;
};

export type ParseResult =
  | { ok: true; data: ParsedSpeakerSubmission }
  | { ok: false; error: string };

/** Validates a raw speaker-intake POST body. Pure — no I/O, easy to test. */
export function parseSpeakerSubmission(payload: unknown): ParseResult {
  const { name, email, organization, referredBy, availability, needs, publicOptIn } =
    (payload ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || name.trim().length === 0) {
    return { ok: false, error: "`name` is required." };
  }
  if (typeof email !== "string" || !email.includes("@")) {
    return { ok: false, error: "`email` must be a valid email address." };
  }
  if (organization !== undefined && typeof organization !== "string") {
    return { ok: false, error: "`organization` must be a string." };
  }
  if (typeof referredBy !== "string" || referredBy.trim().length === 0) {
    return { ok: false, error: "`referredBy` is required." };
  }
  if (!Array.isArray(availability) || availability.length === 0) {
    return { ok: false, error: "`availability` must be a non-empty list of dates." };
  }
  const dates: Date[] = [];
  for (const d of availability) {
    if (typeof d !== "string" || Number.isNaN(Date.parse(d))) {
      return { ok: false, error: "Each `availability` entry must be an ISO date string." };
    }
    dates.push(new Date(d));
  }
  if (needs !== undefined && typeof needs !== "string") {
    return { ok: false, error: "`needs` must be a string." };
  }

  return {
    ok: true,
    data: {
      name: name.trim(),
      email: email.trim(),
      organization: typeof organization === "string" ? organization.trim() : null,
      referredBy: referredBy.trim(),
      availability: dates,
      needs: typeof needs === "string" ? needs.trim() : null,
      publicOptIn: publicOptIn === true,
    },
  };
}
