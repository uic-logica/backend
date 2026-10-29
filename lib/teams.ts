import type { TeamProject } from "@prisma/client";
import { frontendOrigin } from "./linkedin-oauth";
import { PROJECTS } from "./membership-application";
import { notifyUser } from "./notify";
import { prisma } from "./prisma";

/**
 * Software Teams. A member is on one team (User.team, set by the board);
 * their tasks are GitHub issues in the uic-logica org labeled with the
 * team's `team: …` label, the same rule CONTRIBUTING.md already sets.
 */
export const TEAM_LABEL: Record<TeamProject, string> = {
  OPPORTUNITY_BOARD: "team: opportunity-board",
  RESUME_BUILDER: "team: resume-builder",
  EVENT_REPLAYS: "team: event-replays",
  MOCK_INTERVIEWER: "team: mock-interviewer",
};

export const isTeam = (value: unknown): value is TeamProject =>
  typeof value === "string" && (PROJECTS as readonly string[]).includes(value);

/** "https://github.com/Octo-Cat/" or "Octo-Cat" → "octo-cat". Null when it isn't a login. */
export function githubLogin(value: string | null | undefined): string | null {
  const login = value?.trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/\/$/, "");
  return login && /^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(login) ? login.toLowerCase() : null;
}

export type Task = {
  team: TeamProject;
  title: string;
  url: string;
  repo: string;
  number: number;
  assignees: string[];
};

type Issue = {
  title: string;
  html_url: string;
  number: number;
  repository_url: string;
  labels: { name: string }[];
  assignees: { login: string }[] | null;
};

const TTL = 5 * 60_000;
let cache: { at: number; tasks: Task[] } | null = null;

/**
 * Every open team task, from one GitHub search. Null when GitHub can't be
 * reached and nothing is cached, so the UI can say so instead of "no tasks".
 *
 * logica-lean: per-instance 5-minute cache, public repos only, first 100
 * issues — revisit with a webhook if tasks need to appear instantly, or
 * paginate if the teams pass 100 open issues. Set GITHUB_TOKEN (read-only)
 * for the higher rate limit.
 */
export async function teamTasks(): Promise<Task[] | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.tasks;
  const labels = Object.values(TEAM_LABEL).map((label) => `"${label}"`).join(",");
  const q = `org:uic-logica is:issue is:open label:${labels}`;
  try {
    const res = await fetch(`https://api.github.com/search/issues?per_page=100&sort=created&order=asc&q=${encodeURIComponent(q)}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`GitHub search ${res.status}`);
    const { items } = (await res.json()) as { items: Issue[] };
    const tasks = items.flatMap((issue): Task[] => {
      const team = (Object.keys(TEAM_LABEL) as TeamProject[]).find((t) => issue.labels.some((l) => l.name === TEAM_LABEL[t]));
      if (!team) return [];
      return [{
        team,
        title: issue.title,
        url: issue.html_url,
        repo: issue.repository_url.split("/").pop() ?? "",
        number: issue.number,
        assignees: (issue.assignees ?? []).map((a) => a.login.toLowerCase()),
      }];
    });
    cache = { at: Date.now(), tasks };
    return tasks;
  } catch (error) {
    console.warn("team tasks:", (error as Error).message);
    return cache?.tasks ?? null;
  }
}

/** Test hook: forget the cached search. */
export function clearTaskCache() {
  cache = null;
}

export const TEAM_NAME: Record<TeamProject, string> = {
  OPPORTUNITY_BOARD: "Opportunity board",
  RESUME_BUILDER: "Resume builder",
  EVENT_REPLAYS: "Event replays",
  MOCK_INTERVIEWER: "Mock interviewer",
};

/**
 * Put a member on a team (or take them off with null). Fills in their GitHub
 * login from their Software Teams application the first time, since that's
 * who their tasks get assigned to. `notify` is off when this rides along
 * with an acceptance, which already sends them to Software Teams.
 */
export async function placeOnTeam(userId: string, team: TeamProject | null, notify = true) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountKind: true, team: true, github: true } });
  if (user?.accountKind !== "MEMBER") return null;
  const github = user.github ?? (team
    ? githubLogin((await prisma.membershipApplication.findFirst({
        where: { userId, track: "SOFTWARE_ENGINEER" },
        orderBy: { createdAt: "desc" },
        select: { github: true },
      }))?.github)
    : null);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { team, github },
    select: { id: true, name: true, email: true, github: true, team: true },
  });
  if (notify && team && team !== user.team) {
    const name = TEAM_NAME[team];
    await notifyUser(userId, `You're on the ${name} team. Your first-week steps are in Software Teams.`, "decisions", `You're on the ${name} team`, {
      preheader: `You're on the ${name} team.`,
      eyebrow: "Software Teams",
      heading: `Welcome to ${name}`,
      paragraphs: ["Your first-week steps and your team's open tasks are waiting in Software Teams."],
      button: { label: "See what's next", url: `${frontendOrigin()}/dashboard/teams` },
    });
  }
  return updated;
}
