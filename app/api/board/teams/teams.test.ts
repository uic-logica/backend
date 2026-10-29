import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { clearTaskCache, githubLogin, teamTasks } from "@/lib/teams";
import { GET as board } from "./route";
import { PUT as place } from "./[userId]/route";
import { GET as mine } from "../../teams/mine/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    membershipApplication: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

const as = (role: string, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role, accountKind }, expires: "" } as never);
const put = (body: unknown) =>
  place(new NextRequest("http://localhost/api/board/teams/m1", { method: "PUT", body: JSON.stringify(body) }), {
    params: Promise.resolve({ userId: "m1" }),
  });
const issue = (title: string, label: string, assignees: string[] = []) => ({
  title,
  html_url: `https://github.com/uic-logica/frontend/issues/${title.length}`,
  number: title.length,
  repository_url: "https://api.github.com/repos/uic-logica/frontend",
  labels: [{ name: label }],
  assignees: assignees.map((login) => ({ login })),
});
const github = (items: unknown[], ok = true) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ items }), { status: ok ? 200 : 403 }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  clearTaskCache();
});

describe("githubLogin", () => {
  it("takes a login or a profile URL, and rejects anything else", () => {
    expect(githubLogin("Octo-Cat")).toBe("octo-cat");
    expect(githubLogin("https://github.com/Octo-Cat/")).toBe("octo-cat");
    expect(githubLogin("github.com/octocat")).toBe("octocat");
    expect(githubLogin("https://gitlab.com/octocat")).toBeNull();
    expect(githubLogin("")).toBeNull();
    expect(githubLogin(null)).toBeNull();
  });
});

describe("teamTasks", () => {
  it("keeps team-labeled issues, lowercases assignees, and caches", async () => {
    const fetch = github([issue("Spike", "team: opportunity-board", ["Sam"]), issue("Other", "bug")]);
    const tasks = await teamTasks();
    expect(tasks).toEqual([expect.objectContaining({ team: "OPPORTUNITY_BOARD", title: "Spike", repo: "frontend", assignees: ["sam"] })]);
    await teamTasks();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when GitHub fails and nothing is cached", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    github([], false);
    expect(await teamTasks()).toBeNull();
  });
});

describe("GET /api/board/teams", () => {
  it("refuses everyone outside the workspace", async () => {
    for (const [role, kind] of [["MEMBER", "MEMBER"], ["BOARD", "MEMBER"], ["EXEC_BOARD", "SPEAKER"]]) {
      as(role, kind);
      expect((await board()).status).toBe(403);
    }
  });

  it("lists placed members with task counts and accepted people not on a team, once each", async () => {
    as("EXEC_BOARD");
    github([issue("Spike", "team: opportunity-board", ["sam"]), issue("Model", "team: opportunity-board")]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "s", name: "Sam", email: "s@uic.edu", github: "sam", team: "OPPORTUNITY_BOARD" }] as never);
    vi.mocked(prisma.membershipApplication.findMany).mockResolvedValue([
      { userId: "s", name: "Sam" },
      { userId: "m", name: "Maya" },
      { userId: "m", name: "Maya (older)" },
    ] as never);
    const body = await (await board()).json();
    expect(body.members).toEqual([expect.objectContaining({ id: "s", openTasks: 1 })]);
    expect(body.unplaced.map((a: { name: string }) => a.name)).toEqual(["Maya"]);
    expect(body.upForGrabs.OPPORTUNITY_BOARD).toBe(1);
  });
});

describe("PUT /api/board/teams/:userId", () => {
  it("is exec only and validates the team", async () => {
    as("BOARD");
    expect((await put({ team: "RESUME_BUILDER" })).status).toBe(403);
    as("EXEC_BOARD");
    expect((await put({ team: "NOPE" })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("places a member, fills their GitHub login from the application, and tells them", async () => {
    as("EXEC_BOARD");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ accountKind: "MEMBER", team: null, github: null } as never);
    vi.mocked(prisma.membershipApplication.findFirst).mockResolvedValue({ github: "https://github.com/Maya" } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "m1", team: "RESUME_BUILDER" } as never);
    expect((await put({ team: "RESUME_BUILDER" })).status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { team: "RESUME_BUILDER", github: "maya" } }));
    expect(notifyUser).toHaveBeenCalledWith("m1", expect.stringContaining("Resume builder"), "decisions", expect.any(String), expect.any(Object));
  });

  it("takes someone off a team without a notification, and 404s guests", async () => {
    as("EXEC_BOARD");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ accountKind: "MEMBER", team: "RESUME_BUILDER", github: "maya" } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "m1", team: null } as never);
    expect((await put({ team: null })).status).toBe(200);
    expect(notifyUser).not.toHaveBeenCalled();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ accountKind: "SPEAKER", team: null, github: null } as never);
    expect((await put({ team: "RESUME_BUILDER" })).status).toBe(404);
  });
});

describe("GET /api/teams/mine", () => {
  it("needs a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await mine()).status).toBe(401);
  });

  it("splits the team's tasks into mine and up for grabs", async () => {
    as("MEMBER");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ team: "OPPORTUNITY_BOARD", github: "sam" } as never);
    github([
      issue("Spike", "team: opportunity-board", ["sam"]),
      issue("Model", "team: opportunity-board"),
      issue("Taken", "team: opportunity-board", ["ana"]),
      issue("Elsewhere", "team: resume-builder"),
    ]);
    const body = await (await mine()).json();
    expect(body.mine.map((t: { title: string }) => t.title)).toEqual(["Spike"]);
    expect(body.open.map((t: { title: string }) => t.title)).toEqual(["Model"]);
  });

  it("returns no team without calling GitHub", async () => {
    as("MEMBER");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ team: null, github: null } as never);
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(await (await mine()).json()).toEqual({ team: null, github: null, mine: [], open: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
});
