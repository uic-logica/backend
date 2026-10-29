import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { GET as mine, POST as answer } from "./route";
import { GET as going } from "../going/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notices", () => ({ noticeRsvp: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { rsvp: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() } },
}));

const as = (role: string | null, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue((role ? { user: { id: "u1", role, accountKind }, expires: "" } : null) as never);
const params = { params: Promise.resolve({ id: "e1" }) };
const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/events/e1/rsvp", { method, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/events/:id/rsvp", () => {
  it("is 401 signed out, so the event page can offer sign-in", async () => {
    as(null);
    expect((await mine(req("GET"), params)).status).toBe(401);
  });

  it("returns your answer, or null", async () => {
    as("MEMBER");
    vi.mocked(prisma.rsvp.findUnique).mockResolvedValueOnce({ status: "GOING" } as never).mockResolvedValueOnce(null);
    expect(await (await mine(req("GET"), params)).json()).toEqual({ status: "GOING" });
    expect(await (await mine(req("GET"), params)).json()).toEqual({ status: null });
    expect(prisma.rsvp.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId_userId: { eventId: "e1", userId: "u1" } } }));
  });

  it("still takes an answer the same way", async () => {
    as("MEMBER");
    vi.mocked(prisma.rsvp.upsert).mockResolvedValue({ status: "GOING" } as never);
    expect((await answer(req("POST", { status: "GOING" }), params)).status).toBe(200);
    expect((await answer(req("POST", { status: "MAYBE" }), params)).status).toBe(400);
  });
});

describe("GET /api/events/:id/going", () => {
  it("is board only", async () => {
    as(null);
    expect((await going(req("GET"), params)).status).toBe(401);
    as("MEMBER");
    expect((await going(req("GET"), params)).status).toBe(403);
    expect(prisma.rsvp.findMany).not.toHaveBeenCalled();
  });

  it("lists who's going for the board", async () => {
    as("EXEC_BOARD");
    vi.mocked(prisma.rsvp.findMany).mockResolvedValue([{ user: { id: "u2", name: "Ana", email: "ana@uic.edu" } }] as never);
    expect(await (await going(req("GET"), params)).json()).toEqual([{ id: "u2", name: "Ana", email: "ana@uic.edu" }]);
    expect(prisma.rsvp.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: "e1", status: "GOING" } }));
  });
});
