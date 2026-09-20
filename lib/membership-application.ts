import type { ApplicationStatus, ApplicationTrack } from "@prisma/client";
import { isAllowedEmail } from "./otp";

export const TRACKS = ["GENERAL", "SOFTWARE_ENGINEER", "MENTORSHIP"] as const satisfies readonly ApplicationTrack[];
export const STATUSES = ["PENDING", "INTERVIEW", "ACCEPTED", "DECLINED"] as const satisfies readonly ApplicationStatus[];

const MAX_SHORT = 100;
const MAX_WHY = 2000;

export type ApplicationInput = {
  name: string;
  email: string;
  track: ApplicationTrack;
  major: string | null;
  gradYear: number | null;
  why: string;
};

export type ParseResult = { ok: true; data: ApplicationInput } | { ok: false; error: string };

function optionalText(value: unknown, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string" || value.length > MAX_SHORT) {
    return { ok: false, error: `\`${field}\` must be text under ${MAX_SHORT} characters.` };
  }
  return { ok: true, value: value.trim() || null };
}

/** Validates a public application. Pure, so it's testable without a database. */
export function parseApplication(payload: unknown): ParseResult {
  const { name, email, track, major, gradYear, why } = (payload ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim() || name.length > MAX_SHORT) {
    return { ok: false, error: `\`name\` is required (under ${MAX_SHORT} characters).` };
  }
  if (typeof email !== "string" || !isAllowedEmail(email)) {
    return { ok: false, error: "`email` must be your UIC email." };
  }
  if (typeof track !== "string" || !TRACKS.includes(track as ApplicationTrack)) {
    return { ok: false, error: `\`track\` must be one of: ${TRACKS.join(", ")}.` };
  }
  if (typeof why !== "string" || !why.trim() || why.length > MAX_WHY) {
    return { ok: false, error: `\`why\` is required (under ${MAX_WHY} characters).` };
  }
  if (
    gradYear !== undefined &&
    gradYear !== null &&
    !(typeof gradYear === "number" && Number.isInteger(gradYear) && gradYear >= 1900 && gradYear <= 2100)
  ) {
    return { ok: false, error: "`gradYear` must be a four-digit year." };
  }

  const parsedMajor = optionalText(major, "major");
  if (!parsedMajor.ok) return parsedMajor;

  return {
    ok: true,
    data: {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      track: track as ApplicationTrack,
      major: parsedMajor.value,
      gradYear: (gradYear as number | null | undefined) ?? null,
      why: why.trim(),
    },
  };
}

export function isStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && STATUSES.includes(value as ApplicationStatus);
}
