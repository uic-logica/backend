import type { EmailContent } from "@/lib/email-layout";
import { frontendOrigin } from "@/lib/linkedin-oauth";
import type { ApplicationStatus, ApplicationTrack, TeamProject } from "@prisma/client";
import { isAllowedEmail } from "./otp";

// ApplicationTrack is every stored value; TRACKS is what new public applications accept.
export const TRACKS = ["SOFTWARE_ENGINEER", "BOARD_MEMBER"] as const satisfies readonly ApplicationTrack[];
export const STATUSES = ["PENDING", "INTERVIEW", "NEEDS_INFO", "ACCEPTED", "DECLINED"] as const satisfies readonly ApplicationStatus[];
export const PROJECTS = ["OPPORTUNITY_BOARD", "RESUME_BUILDER", "EVENT_REPLAYS", "MOCK_INTERVIEWER"] as const satisfies readonly TeamProject[];

const MAX_SHORT = 100;
const MIN_WHY = 40;
const MAX_WHY = 2000;
const GITHUB = /^(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/?$|^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/i;

type CommonApplicationInput = {
  name: string;
  email: string;
  track: ApplicationTrack;
  major: string;
  gradYear: number;
  why: string;
};

export type ApplicationInput =
  | CommonApplicationInput & { track: "BOARD_MEMBER" }
  | CommonApplicationInput & {
      track: "SOFTWARE_ENGINEER";
      github: string;
      hoursPerWeek: number;
      projects: TeamProject[];
      skills: string;
      resumeUrl: string | null;
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
  const { name, email, track, major, gradYear, why, github, hoursPerWeek, projects, skills, resumeUrl } = (payload ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim() || name.length > MAX_SHORT) {
    return { ok: false, error: `\`name\` is required (under ${MAX_SHORT} characters).` };
  }
  if (typeof track !== "string" || !TRACKS.includes(track as (typeof TRACKS)[number])) {
    return { ok: false, error: `\`track\` must be one of: ${TRACKS.join(", ")}.` };
  }
  if (typeof email !== "string" || (track === "BOARD_MEMBER" ? !isAllowedEmail(email) : !email.toLowerCase().endsWith("@uic.edu"))) {
    return { ok: false, error: "`email` must be your UIC email." };
  }
  if (typeof why !== "string" || why.trim().length < MIN_WHY || why.length > MAX_WHY) {
    return { ok: false, error: `\`why\` needs at least ${MIN_WHY} characters (under ${MAX_WHY}).` };
  }
  if (!(typeof gradYear === "number" && Number.isInteger(gradYear) && gradYear >= 1900 && gradYear <= 2100)) {
    return { ok: false, error: "`gradYear` is required: a four-digit year." };
  }

  const parsedMajor = optionalText(major, "major");
  if (!parsedMajor.ok) return parsedMajor;
  if (!parsedMajor.value) return { ok: false, error: "`major` is required." };

  const common = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    track: track as ApplicationTrack,
    major: parsedMajor.value,
    gradYear,
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
    if (typeof skills !== "string" || skills.trim().length < 3 || skills.length > 500) {
      return { ok: false, error: "`skills` is required (3-500 characters)." };
    }
    // Required, but either this link or a PDF on the profile counts; the route checks the profile.
    const link = typeof resumeUrl === "string" ? resumeUrl.trim() : "";
    if (resumeUrl !== undefined && resumeUrl !== null && (typeof resumeUrl !== "string" || link.length > 500 || (link && !/^https:\/\/\S+$/i.test(link)))) {
      return { ok: false, error: "`resumeUrl` must be an https:// link under 500 characters." };
    }

    return {
      ok: true,
      data: {
        ...common,
        track: "SOFTWARE_ENGINEER",
        github: github.trim(),
        hoursPerWeek,
        projects: projects as TeamProject[],
        skills: skills.trim(),
        resumeUrl: link || null,
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

// logica-lean: one fixed cooldown for every track. Revisit if the board wants it per role or per term.
export const REAPPLY_COOLDOWN_DAYS = 90;

type PastApplication = { status: ApplicationStatus; canReapply: boolean; decidedAt: Date | null; createdAt: Date };

/**
 * Whether someone may send a new application for a track, given their earlier
 * ones for it. Pure so the rule is testable; the route supplies the rows.
 */
export function reapplyBlock(past: PastApplication[], now = new Date()): string | null {
  if (past.some((a) => a.status === "NEEDS_INFO")) {
    return "The board asked for more on your application. Update it from your dashboard instead of starting a new one.";
  }
  if (past.some((a) => a.status === "PENDING" || a.status === "INTERVIEW")) {
    return "You already have an application in for this track.";
  }
  if (past.some((a) => a.status === "ACCEPTED")) return "You were already accepted for this track.";
  const latest = [...past].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (latest?.status !== "DECLINED") return null;
  if (!latest.canReapply) return "You can't reapply for this role.";
  const from = new Date((latest.decidedAt ?? latest.createdAt).getTime() + REAPPLY_COOLDOWN_DAYS * 864e5);
  if (from > now) return `You can reapply for this role from ${from.toISOString().slice(0, 10)}.`;
  return null;
}

/** What the applicant reads for each decision (in-app line and email). PENDING sends nothing. */
export function applicantNotice(
  status: string,
  role: string,
  note: string,
  canReapply: boolean,
  interviewLink?: string,
): { message: string; content: EmailContent } | null {
  const dashboard = `${frontendOrigin()}/dashboard`;
  switch (status) {
    case "INTERVIEW":
      return {
        message: `LOGICA would like to talk with you about your ${role} application. Share when you can meet and the board will set up a time.`,
        content: {
          preheader: "The board would like to talk with you.",
          eyebrow: "Application update",
          heading: "Let's talk",
          paragraphs: [
            `The board read your ${role} application and would like to talk with you.`,
            "Pick the times that work for you and the board will set up your interview.",
          ],
          button: interviewLink ? { label: "Share your availability", url: interviewLink } : { label: "Open your dashboard", url: dashboard },
          footnote: interviewLink ? "This link is just for you. You can come back to it to change your times." : undefined,
        },
      };
    case "NEEDS_INFO":
      return {
        message: `LOGICA needs a bit more on your ${role} application: ${note}`,
        content: {
          preheader: "The board has one ask about your application.",
          eyebrow: "Application update",
          heading: "We need a bit more",
          paragraphs: [`The board read your ${role} application and has one ask:`],
          quote: note,
          button: { label: "Update your application", url: dashboard },
        },
      };
    case "ACCEPTED":
      return {
        message: `You're in: your ${role} application to LOGICA was accepted. Next steps are in your dashboard.`,
        content: {
          preheader: `Your ${role} application was accepted.`,
          eyebrow: "Welcome to LOGICA",
          heading: "You're in",
          paragraphs: [`Your ${role} application was accepted. Your next steps are waiting in your dashboard.`],
          button: { label: "See next steps", url: dashboard },
        },
      };
    case "DECLINED":
      return {
        message: `Thank you for applying to LOGICA. We can't offer you a ${role} spot this time.${canReapply ? " You're welcome to apply again next semester." : ""}`,
        content: {
          eyebrow: "Application update",
          heading: "Thank you for applying",
          paragraphs: [
            `We can't offer you a ${role} spot this time.${canReapply ? " You're welcome to apply again next semester." : ""}`,
            "Our events stay open to you.",
          ],
          button: { label: "See upcoming events", url: `${frontendOrigin()}/events` },
        },
      };
    default:
      return null;
  }
}
