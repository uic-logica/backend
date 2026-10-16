import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { GET, PATCH } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { emailPreference: { findUnique: vi.fn(), upsert: vi.fn() } } }));

const as = (role: string, accountKind = "MEMBER") => vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role, accountKind }, expires: "" } as never);
const patch = (body: unknown) => PATCH(new NextRequest("http://localhost/api/email-preferences", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.emailPreference.findUnique).mockResolvedValue({ modes: { events: "OFF" } } as never);
});

describe("/api/email-preferences", () => {
  it("lists a member's categories with how each emails now", async () => {
    as("MEMBER");
    const body = await (await GET()).json();
    expect(body.modes).toEqual(["INSTANT", "OFF"]);
    expect(body.categories.map((c: { key: string; mode: string }) => `${c.key}:${c.mode}`)).toEqual(["messages:INSTANT", "events:OFF", "announcements:INSTANT"]);
  });

  it("saves one category, keeping the others", async () => {
    as("EXEC_BOARD");
    expect((await patch({ category: "boardUpdates", mode: "SUMMARY" })).status).toBe(200);
    expect(prisma.emailPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { modes: { events: "OFF", boardUpdates: "SUMMARY" } } }));
  });

  it("refuses the summary for non-execs, exec categories for members, and decisions for anyone", async () => {
    as("MEMBER");
    expect((await patch({ category: "events", mode: "SUMMARY" })).status).toBe(400);
    expect((await patch({ category: "guestReplies", mode: "OFF" })).status).toBe(400);
    as("EXEC_BOARD");
    expect((await patch({ category: "decisions", mode: "OFF" })).status).toBe(400);
    expect(prisma.emailPreference.upsert).not.toHaveBeenCalled();
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET()).status).toBe(401);
  });
});
