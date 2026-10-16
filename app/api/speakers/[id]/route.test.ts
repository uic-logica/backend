import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DELETE, PATCH } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyUser: vi.fn(), tell: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    speakerSubmission: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn(async () => []), updateMany: vi.fn() },
    user: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const as = (role: string, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role, accountKind }, expires: "" } as never);
const patch = (body: unknown) =>
  PATCH(new NextRequest("http://localhost/api/speakers/s1", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "s1" }),
  });
const talk = { title: "Agents in prod", startsAt: "2026-11-05T23:00:00.000Z", location: "SELE 2252" };

beforeEach(() => {
  vi.clearAllMocks();
  as("EXEC_BOARD");
  vi.mocked(prisma.speakerSubmission.findUnique).mockResolvedValue({ id: "s1", eventId: null } as never);
  vi.mocked(prisma.speakerSubmission.update).mockResolvedValue({ id: "s1", user: null } as never);
});

describe("PATCH /api/speakers/:id newEvent", () => {
  it("creates the event and links it in one write", async () => {
    expect((await patch({ newEvent: talk })).status).toBe(200);
    expect(prisma.speakerSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: {
          event: {
            create: {
              title: "Agents in prod",
              startsAt: new Date(talk.startsAt),
              location: "SELE 2252",
              description: undefined,
              link: undefined,
            },
          },
        },
      }),
    );
  });

  it("is exec only", async () => {
    for (const [role, kind] of [["BOARD", "MEMBER"], ["MEMBER", "MEMBER"], ["EXEC_BOARD", "SPEAKER"]]) {
      as(role, kind);
      expect((await patch({ newEvent: talk })).status).toBe(403);
    }
    expect(prisma.speakerSubmission.update).not.toHaveBeenCalled();
  });

  it("refuses when the guest already has an event, so nothing is orphaned", async () => {
    vi.mocked(prisma.speakerSubmission.findUnique).mockResolvedValue({ id: "s1", eventId: "e0" } as never);
    expect((await patch({ newEvent: talk })).status).toBe(409);
    expect(prisma.speakerSubmission.update).not.toHaveBeenCalled();
  });

  it("creates it with the date TBD when no time is sent", async () => {
    expect((await patch({ newEvent: { title: "Agents in prod" } })).status).toBe(200);
    expect(prisma.speakerSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { event: { create: expect.objectContaining({ title: "Agents in prod", startsAt: undefined }) } } }),
    );
  });

  it("rejects a missing title, a bad link, or eventId alongside it", async () => {
    expect((await patch({ newEvent: { startsAt: talk.startsAt } })).status).toBe(400);
    expect((await patch({ newEvent: { ...talk, link: "javascript:alert(1)" } })).status).toBe(400);
    expect((await patch({ newEvent: talk, eventId: "e2" })).status).toBe(400);
    expect(prisma.speakerSubmission.update).not.toHaveBeenCalled();
  });

  it("still links and unlinks an existing event", async () => {
    await patch({ eventId: "e2" });
    expect(prisma.speakerSubmission.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { event: { connect: { id: "e2" } } } }),
    );
    await patch({ eventId: null });
    expect(prisma.speakerSubmission.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { event: { disconnect: true } } }),
    );
  });
});

describe("DELETE /api/speakers/:id", () => {
  const del = () => DELETE(new NextRequest("http://localhost/api/speakers/s1", { method: "DELETE" }), { params: Promise.resolve({ id: "s1" }) });

  it("removes the guest and only their speaker sign-in", async () => {
    expect((await del()).status).toBe(204);
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({ where: { speakerSubmissionId: "s1", accountKind: "SPEAKER" } });
    expect(prisma.speakerSubmission.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("is exec only and 404s for an unknown guest", async () => {
    for (const [role, kind] of [["BOARD", "MEMBER"], ["MEMBER", "MEMBER"], ["EXEC_BOARD", "SPEAKER"]]) {
      as(role, kind);
      expect((await del()).status).toBe(403);
    }
    as("EXEC_BOARD");
    vi.mocked(prisma.speakerSubmission.findUnique).mockResolvedValue(null);
    expect((await del()).status).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/speakers/:id eventId", () => {
  it("links a second guest to an event another guest already has", async () => {
    vi.mocked(prisma.speakerSubmission.findUnique).mockResolvedValue({ id: "s2", eventId: null, email: "jona@example.com", status: "PENDING" } as never);
    vi.mocked(prisma.speakerSubmission.update).mockResolvedValue({ id: "s2", user: null, event: { id: "shared", title: "Rise Reforming", startsAt: null, location: null } } as never);
    expect((await patch({ eventId: "shared" })).status).toBe(200);
    expect(prisma.speakerSubmission.update).toHaveBeenCalledWith(expect.objectContaining({ data: { event: { connect: { id: "shared" } } } }));
  });
});
