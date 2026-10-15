import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth, partnerAuth } from "@/auth";
import { prisma } from "@/lib/prisma";
import * as list from "./route";
import * as one from "./[id]/route";
import * as mine from "../partner-events/route";

vi.mock("@/auth", () => ({ auth: vi.fn(), partnerAuth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    event: { findUnique: vi.fn(), findMany: vi.fn() },
    eventAccess: { upsert: vi.fn(), deleteMany: vi.fn() },
    session: { deleteMany: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  },
}));

const as = (role: string, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role, accountKind }, expires: "" } as never);
const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/partners", { method, body: body === undefined ? undefined : JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "p1" }) };
const create = () => list.POST(req("POST", { name: "ACM UIC", email: "Board@ACM.org" }));
const grant = (access: boolean) => one.PATCH(req("PATCH", { eventId: "e1", access }), params);

beforeEach(() => {
  vi.clearAllMocks();
  as("EXEC_BOARD");
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.user.create).mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }) as never);
  vi.mocked(prisma.user.update).mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }) as never);
});

describe("managing partner clubs is exec only", () => {
  it.each([["BOARD", "MEMBER"], ["MEMBER", "MEMBER"], ["EXEC_BOARD", "SPEAKER"]])("refuses %s/%s", async (role, kind) => {
    as(role, kind);
    expect((await list.GET()).status).toBe(403);
    expect((await create()).status).toBe(403);
    expect((await grant(true)).status).toBe(403);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.eventAccess.upsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/partners", () => {
  it("creates a PARTNER account with a one-time password it must change", async () => {
    const res = await create();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tempPassword).toEqual(expect.any(String));
    const { data } = vi.mocked(prisma.user.create).mock.calls[0][0];
    expect(data).toMatchObject({ email: "board@acm.org", accountKind: "PARTNER", mustChangePassword: true });
    expect(data).not.toHaveProperty("role"); // stays the MEMBER default, never a board role
    expect(data.passwordHash).not.toBe(body.tempPassword);
  });

  it("resets an existing partner's password and signs them out", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "p1", accountKind: "PARTNER" } as never);
    expect((await create()).status).toBe(200);
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "p1" } });
  });

  it("never turns a member or guest account into a partner", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "m1", accountKind: "MEMBER" } as never);
    expect((await create()).status).toBe(409);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/partners/:id", () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ accountKind: "PARTNER" } as never);
    vi.mocked(prisma.event.findUnique).mockResolvedValue({ id: "e1" } as never);
  });

  it("grants and revokes one event", async () => {
    expect((await grant(true)).status).toBe(200);
    expect(prisma.eventAccess.upsert).toHaveBeenCalled();
    expect((await grant(false)).status).toBe(200);
    expect(prisma.eventAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "p1", eventId: "e1" } });
  });

  it("only grants to partner accounts", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ accountKind: "MEMBER" } as never);
    expect((await grant(true)).status).toBe(404);
    expect(prisma.eventAccess.upsert).not.toHaveBeenCalled();
  });
});

describe("GET /api/partner-events", () => {
  it("lists only the signed-in partner's granted events", async () => {
    vi.mocked(partnerAuth).mockResolvedValue({ user: { id: "p1", accountKind: "PARTNER" } } as never);
    vi.mocked(prisma.event.findMany).mockResolvedValue([]);
    expect((await mine.GET()).status).toBe(200);
    expect(vi.mocked(prisma.event.findMany).mock.calls[0][0]?.where).toEqual({ partners: { some: { userId: "p1" } } });
  });

  it("is for partner accounts only", async () => {
    vi.mocked(partnerAuth).mockResolvedValue({ user: { id: "u1", accountKind: "MEMBER", role: "EXEC_BOARD" } } as never);
    expect((await mine.GET()).status).toBe(403);
  });
});
