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

  it("accepts a board member application", async () => {
    const response = await submit("BOARD_MEMBER");

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "app-1" });
    expect(prisma.membershipApplication.create).toHaveBeenCalledWith({
      data: { ...application, track: "BOARD_MEMBER" },
    });
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
