import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  membershipApplication: {
    findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(),
  },
  user: { findFirst: vi.fn(), findUnique: vi.fn() },
} }));

import { auth } from "@/auth";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import * as list from "./route";
import * as review from "./[id]/route";
import * as mine from "./mine/route";
import * as update from "./mine/[id]/route";

const params = { params: Promise.resolve({ id: "app-1" }) };
const request = () =>
  new NextRequest("http://localhost/api/join/app-1", { method: "PATCH", body: JSON.stringify({ status: "ACCEPTED" }) });

// Rejected before any database call, so no database is needed.
const boardOnly = [
  ["GET /api/join", () => list.GET()],
  ["PATCH /api/join/:id", () => review.PATCH(request(), params)],
] as const;

describe.each(boardOnly)("%s", (_name, call) => {
  beforeEach(() => vi.mocked(auth).mockReset());

  it("rejects a MEMBER", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "MEMBER" }, expires: "" } as never);
    expect((await call()).status).toBe(403);
  });

  it("rejects a signed-out request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await call()).status).toBe(401);
  });
});

describe("POST /api/join", () => {
  const invalidProjects: string[][] = [
    [],
    ["OPPORTUNITY_BOARD", "OPPORTUNITY_BOARD"],
    ["UNKNOWN"],
  ];
  const application = {
    name: "Ada Lovelace",
    email: "ada@uic.edu",
    major: "Computer Science",
    gradYear: 2028,
    why: "I want to contribute to the club and learn by building real things.",
  };
  const submit = (track: string) => list.POST(new NextRequest("http://localhost/api/join", {
    method: "POST",
    body: JSON.stringify({ ...application, track }),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "uic.edu");
    vi.mocked(prisma.membershipApplication.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.membershipApplication.create).mockResolvedValue({ id: "app-1" } as never);
  });

  const signedIn = (email = "ada@uic.edu") => vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", email, role: "MEMBER" }, expires: "",
  } as never);

  it("accepts a board member application", async () => {
    const response = await submit("BOARD_MEMBER");

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "app-1" });
    expect(prisma.membershipApplication.create).toHaveBeenCalledWith({
      data: { ...application, track: "BOARD_MEMBER" },
    });
  });

  it("requires sign-in for a software engineer application", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await submit("SOFTWARE_ENGINEER");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in with your UIC account to apply to a build team." });
  });

  it("requires a UIC session for a software engineer application", async () => {
    signedIn("ada@example.com");

    const response = await submit("SOFTWARE_ENGINEER");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Build team applications need a @uic.edu account." });
  });

  it("stores build-team fields with the session identity", async () => {
    signedIn("Ada@UIC.edu");
    const fields = {
      github: " github.com/ada ",
      hoursPerWeek: 12,
      projects: ["RESUME_BUILDER", "OPPORTUNITY_BOARD"],
      skills: " TypeScript and React ",
      resumeUrl: " https://drive.google.com/file/d/abc ",
    };
    const response = await list.POST(new NextRequest("http://localhost/api/join", {
      method: "POST",
      body: JSON.stringify({ ...application, email: "ignored@example.com", track: "SOFTWARE_ENGINEER", ...fields }),
    }));

    expect(response.status).toBe(201);
    expect(prisma.membershipApplication.create).toHaveBeenCalledWith({
      data: {
        ...application,
        email: "ada@uic.edu",
        track: "SOFTWARE_ENGINEER",
        github: "github.com/ada",
        hoursPerWeek: 12,
        projects: fields.projects,
        skills: "TypeScript and React",
        resumeUrl: "https://drive.google.com/file/d/abc",
        userId: "user-1",
      },
    });
  });

  it.each(invalidProjects)("rejects invalid project rankings: %j", async (projects) => {
    signedIn();
    const response = await list.POST(new NextRequest("http://localhost/api/join", {
      method: "POST",
      body: JSON.stringify({ ...application, track: "SOFTWARE_ENGINEER", github: "ada", hoursPerWeek: 10, skills: "Go, SQL", projects }),
    }));

    expect(response.status).toBe(400);
    expect(prisma.membershipApplication.create).not.toHaveBeenCalled();
  });

  it.each([0, 41, 2.5])("rejects invalid weekly hours: %s", async (hoursPerWeek) => {
    signedIn();
    const response = await list.POST(new NextRequest("http://localhost/api/join", {
      method: "POST",
      body: JSON.stringify({
        ...application, track: "SOFTWARE_ENGINEER", github: "ada", hoursPerWeek, skills: "Go, SQL",
        projects: ["EVENT_REPLAYS"],
      }),
    }));

    expect(response.status).toBe(400);
  });

  const build = { github: "ada", hoursPerWeek: 10, projects: ["EVENT_REPLAYS"], skills: "Go, SQL" };
  const post = (body: object) => list.POST(new NextRequest("http://localhost/api/join", { method: "POST", body: JSON.stringify(body) }));

  it.each(["major", "gradYear", "why"])("requires %s", async (field) => {
    const response = await post({ ...application, track: "BOARD_MEMBER", [field]: undefined });
    expect(response.status).toBe(400);
  });

  it("rejects a one-line why", async () => {
    expect((await post({ ...application, why: "I like code.", track: "BOARD_MEMBER" })).status).toBe(400);
  });

  it("requires skills on a build-team application", async () => {
    signedIn();
    expect((await post({ ...application, track: "SOFTWARE_ENGINEER", ...build, skills: "" })).status).toBe(400);
  });

  it("requires a resume link or a profile PDF", async () => {
    signedIn();
    const response = await post({ ...application, track: "SOFTWARE_ENGINEER", ...build });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Add a resume: upload a PDF on your profile or paste a link." });

    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-1" } as never);
    expect((await post({ ...application, track: "SOFTWARE_ENGINEER", ...build })).status).toBe(201);
  });

  it("blocks reapplying after a final decline", async () => {
    vi.mocked(prisma.membershipApplication.findMany).mockResolvedValue([
      { status: "DECLINED", canReapply: false, decidedAt: new Date(), createdAt: new Date() },
    ] as never);
    const response = await submit("BOARD_MEMBER");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "You can't reapply for this role." });
  });

  it.each(["GENERAL", "MENTORSHIP"])("rejects the historical %s track", async (track) => {
    const response = await submit(track);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "`track` must be one of: SOFTWARE_ENGINEER, BOARD_MEMBER.",
    });
    expect(prisma.membershipApplication.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/join/mine", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a signed-out request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await mine.GET()).status).toBe(401);
  });

  it("returns the signed-in member's applications newest first", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", email: "Ada@UIC.edu", role: "MEMBER" }, expires: "",
    } as never);
    const rows = [{
      id: "app-1", track: "SOFTWARE_ENGINEER", status: "PENDING",
      projects: ["OPPORTUNITY_BOARD"], hoursPerWeek: 10, createdAt: new Date("2026-09-28T12:00:00Z"),
    }];
    vi.mocked(prisma.membershipApplication.findMany).mockResolvedValue(rows as never);

    const response = await mine.GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ ...rows[0], createdAt: "2026-09-28T12:00:00.000Z" }]);
    expect(prisma.membershipApplication.findMany).toHaveBeenCalledWith({
      where: { OR: [{ userId: "user-1" }, { email: "ada@uic.edu" }] },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, track: true, status: true, projects: true, hoursPerWeek: true,
        name: true, major: true, gradYear: true, why: true, github: true, skills: true, resumeUrl: true,
        reviewNote: true, canReapply: true, decidedAt: true, createdAt: true,
      },
    });
  });
});

describe("PATCH /api/join/:id review", () => {
  const board = () => vi.mocked(auth).mockResolvedValue({ user: { id: "b1", role: "EXEC_BOARD", accountKind: "MEMBER" }, expires: "" } as never);
  const patch = (body: object) => review.PATCH(new NextRequest("http://localhost/api/join/app-1", { method: "PATCH", body: JSON.stringify(body) }), params);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.membershipApplication.findUnique).mockResolvedValue({ id: "app-1", userId: "u9", email: "ada@uic.edu", track: "BOARD_MEMBER" } as never);
    vi.mocked(prisma.membershipApplication.update).mockResolvedValue({ id: "app-1" } as never);
  });

  it("needs a note to ask for more info", async () => {
    board();
    expect((await patch({ status: "NEEDS_INFO", note: "more" })).status).toBe(400);
  });

  it("stores the note and tells the applicant", async () => {
    board();
    expect((await patch({ status: "NEEDS_INFO", note: "Add a link to a project you built." })).status).toBe(200);
    expect(prisma.membershipApplication.update).toHaveBeenCalledWith({
      where: { id: "app-1" },
      data: expect.objectContaining({ status: "NEEDS_INFO", reviewNote: "Add a link to a project you built." }),
    });
    expect(notifyUser).toHaveBeenCalledWith("u9", expect.stringContaining("Add a link to a project you built."), "announcements");
  });

  it("records a final decline", async () => {
    board();
    await patch({ status: "DECLINED", canReapply: false });
    expect(prisma.membershipApplication.update).toHaveBeenCalledWith({
      where: { id: "app-1" },
      data: expect.objectContaining({ status: "DECLINED", canReapply: false, decidedAt: expect.any(Date) }),
    });
  });
});

describe("PATCH /api/join/mine/:id", () => {
  const body = { name: "Ada", major: "CS", gradYear: 2028, why: "Here is a longer answer about why I want to join the board." };
  const call = () => update.PATCH(new NextRequest("http://localhost/api/join/mine/app-1", { method: "PATCH", body: JSON.stringify(body) }), params);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "uic.edu");
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", email: "ada@uic.edu", role: "MEMBER" }, expires: "" } as never);
    vi.mocked(prisma.membershipApplication.update).mockResolvedValue({ id: "app-1", status: "PENDING" } as never);
  });

  it("returns an answered application to PENDING", async () => {
    vi.mocked(prisma.membershipApplication.findUnique).mockResolvedValue({ id: "app-1", userId: null, email: "ada@uic.edu", track: "BOARD_MEMBER", status: "NEEDS_INFO" } as never);
    expect((await call()).status).toBe(200);
    expect(prisma.membershipApplication.update).toHaveBeenCalledWith({
      where: { id: "app-1" },
      data: expect.objectContaining({ status: "PENDING", email: "ada@uic.edu", track: "BOARD_MEMBER" }),
    });
  });

  it("hides someone else's application", async () => {
    vi.mocked(prisma.membershipApplication.findUnique).mockResolvedValue({ id: "app-1", userId: "u2", email: "bob@uic.edu", track: "BOARD_MEMBER", status: "NEEDS_INFO" } as never);
    expect((await call()).status).toBe(404);
  });

  it("only edits while the board is waiting", async () => {
    vi.mocked(prisma.membershipApplication.findUnique).mockResolvedValue({ id: "app-1", userId: "u1", email: "ada@uic.edu", track: "BOARD_MEMBER", status: "PENDING" } as never);
    expect((await call()).status).toBe(409);
  });
});
