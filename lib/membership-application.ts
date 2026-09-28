import type { ApplicationStatus, ApplicationTrack, TeamProject } from "@prisma/client";
import { isAllowedEmail } from "./otp";

// ApplicationTrack is every stored value; TRACKS is what new public applications accept.
export const TRACKS = ["SOFTWARE_ENGINEER", "BOARD_MEMBER"] as const satisfies readonly ApplicationTrack[];
export const STATUSES = ["PENDING", "INTERVIEW", "ACCEPTED", "DECLINED"] as const satisfies readonly ApplicationStatus[];
export const PROJECTS = ["OPPORTUNITY_BOARD", "RESUME_BUILDER", "EVENT_REPLAYS", "MOCK_INTERVIEWER"] as const satisfies readonly TeamProject[];

const MAX_SHORT = 100;
const MAX_WHY = 2000;
const GITHUB = /^(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/?$|^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/i;

type CommonApplicationInput = {
  name: string;
  email: string;
  track: ApplicationTrack;
  major: string | null;
  gradYear: number | null;
  why: string;
};

export type ApplicationInput =
  | CommonApplicationInput & { track: "BOARD_MEMBER" }
  | CommonApplicationInput & {
      track: "SOFTWARE_ENGINEER";
      github: string;
      hoursPerWeek: number;
      projects: TeamProject[];
      skills: string | null;
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
  const { name, email, track, major, gradYear, why, github, hoursPerWeek, projects, skills } = (payload ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim() || name.length > MAX_SHORT) {
    return { ok: false, error: `\`name\` is required (under ${MAX_SHORT} characters).` };
  }
  if (typeof track !== "string" || !TRACKS.includes(track as (typeof TRACKS)[number])) {
    return { ok: false, error: `\`track\` must be one of: ${TRACKS.join(", ")}.` };
  }
  if (typeof email !== "string" || (track === "BOARD_MEMBER" ? !isAllowedEmail(email) : !email.toLowerCase().endsWith("@uic.edu"))) {
    return { ok: false, error: "`email` must be your UIC email." };
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

  const common = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    track: track as ApplicationTrack,
    major: parsedMajor.value,
    gradYear: (gradYear as number | null | undefined) ?? null,
    why: why.trim(),
  };

  if (track === "SOFTWARE_ENGINEER") {
    if (typeof github !== "string" || !github.trim() || github.length > MAX_SHORT || !GITHUB.test(github.trim())) {
      return { ok: false, error: `\`github\` must be a GitHub username or github.com URL (under ${MAX_SHORT} characters).` };
    }
    if (typeof hoursPerWeek !== "number" || !Number.isInteger(hoursPerWeek) || hoursPerWeek < 1 || hoursPerWeek > 40) {
      return { ok: false, error: "`hoursPerWeek` must be an integer from 1 to 40." };
    }
    if (!Array.isArray(projects) || projects.length < 1 || projects.length > PROJECTS.length) {
      return { ok: false, error: `\`projects\` must rank 1-${PROJECTS.length} projects.` };
    }
    if (projects.some((project) => typeof project !== "string" || !PROJECTS.includes(project as TeamProject))) {
      return { ok: false, error: `\`projects\` values must be one of: ${PROJECTS.join(", ")}.` };
    }
    if (new Set(projects).size !== projects.length) {
      return { ok: false, error: "`projects` must not contain duplicates." };
    }
    if (skills !== undefined && skills !== null && (typeof skills !== "string" || skills.length > 500)) {
      return { ok: false, error: "`skills` must be text under 500 characters." };
    }

    return {
      ok: true,
      data: {
        ...common,
        track: "SOFTWARE_ENGINEER",
        github: github.trim(),
        hoursPerWeek,
        projects: projects as TeamProject[],
        skills: typeof skills === "string" ? skills.trim() || null : null,
      },
    };
  }

  return {
    ok: true,
    data: { ...common, track: "BOARD_MEMBER" },
  };
}

export function isStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && STATUSES.includes(value as ApplicationStatus);
}
