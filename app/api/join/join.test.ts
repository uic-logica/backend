import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  membershipApplication: {
    findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(),
  },
} }));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import * as list from "./route";
import * as review from "./[id]/route";
import * as mine from "./mine/route";

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
    why: "I want to contribute.",
  };
  const submit = (track: string) => list.POST(new NextRequest("http://localhost/api/join", {
    method: "POST",
    body: JSON.stringify({ ...application, track }),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "uic.edu");
    vi.mocked(prisma.membershipApplication.findFirst).mockResolvedValue(null);
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
        userId: "user-1",
      },
    });
  });

  it.each(invalidProjects)("rejects invalid project rankings: %j", async (projects) => {
    signedIn();
    const response = await list.POST(new NextRequest("http://localhost/api/join", {
      method: "POST",
      body: JSON.stringify({ ...application, track: "SOFTWARE_ENGINEER", github: "ada", hoursPerWeek: 10, projects }),
    }));

    expect(response.status).toBe(400);
    expect(prisma.membershipApplication.create).not.toHaveBeenCalled();
  });

  it.each([0, 41, 2.5])("rejects invalid weekly hours: %s", async (hoursPerWeek) => {
    signedIn();
    const response = await list.POST(new NextRequest("http://localhost/api/join", {
      method: "POST",
      body: JSON.stringify({
        ...application, track: "SOFTWARE_ENGINEER", github: "ada", hoursPerWeek,
        projects: ["EVENT_REPLAYS"],
      }),
    }));

    expect(response.status).toBe(400);
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
        id: true, track: true, status: true, projects: true, hoursPerWeek: true, createdAt: true,
      },
    });
  });
});
