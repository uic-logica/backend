import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PATCH } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { event: { findUnique: vi.fn(), update: vi.fn() } },
}));

const as = (role: string, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role, accountKind }, expires: "" } as never);
const patch = (body: unknown) =>
  PATCH(new NextRequest("http://localhost/api/events/e1", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "e1" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  as("BOARD");
  vi.mocked(prisma.event.findUnique).mockResolvedValue({ id: "e1" } as never);
  vi.mocked(prisma.event.update).mockImplementation(({ data }) => Promise.resolve({ id: "e1", ...data }) as never);
});

describe("PATCH /api/events/:id", () => {
  it("lets a board member change the description and nothing else", async () => {
    const response = await patch({ description: "Pizza at 5:45" });
    expect(response.status).toBe(200);
    expect(prisma.event.update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { description: "Pizza at 5:45" } });
  });

  it("refuses members, speaker accounts and signed-out visitors", async () => {
    as("MEMBER");
    expect((await patch({ title: "x" })).status).toBe(403);
    as("BOARD", "SPEAKER");
    expect((await patch({ title: "x" })).status).toBe(403);
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await patch({ title: "x" })).status).toBe(401);
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it("rejects a bad link or an empty title with 400", async () => {
    expect((await patch({ link: "javascript:alert(1)" })).status).toBe(400);
    expect((await patch({ title: " " })).status).toBe(400);
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it("ignores fields that aren't editable", async () => {
    await patch({ title: "Hack night", remindedAt: null, id: "other" });
    expect(prisma.event.update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { title: "Hack night" } });
  });

  it("404s for an unknown event", async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(null);
    expect((await patch({ title: "x" })).status).toBe(404);
  });
});
