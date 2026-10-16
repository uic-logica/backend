import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { noticeGuestMessage } from "@/lib/notices";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notices", () => ({ noticeGuestMessage: vi.fn() }));
vi.mock("@/lib/speaker-thread", () => ({
  threadLead: vi.fn(async () => "s1"),
  threadMembers: vi.fn(async () => [{ id: "s1", name: "Yurii", email: "y@example.com", user: { id: "u9" } }]),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { speakerSubmission: { updateMany: vi.fn() }, speakerMessage: { create: vi.fn() } } }));

const as = (role: string, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue({ user: { id: "exec1", role, accountKind }, expires: "" } as never);
const ask = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/speakers/s1/availability-request", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "s1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  as("EXEC_BOARD");
});

describe("POST /api/speakers/:id/availability-request", () => {
  it("records the ask, clears the old confirmation, posts it in the thread and emails them", async () => {
    expect((await ask({ from: "2026-11-09", to: "2026-11-13", note: "The week of the 2nd fell through." })).status).toBe(200);
    expect(prisma.speakerSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["s1"] } },
      data: { availabilityRequest: expect.objectContaining({ from: "2026-11-09", to: "2026-11-13", note: "The week of the 2nd fell through." }), availabilityConfirmedAt: null },
    });
    const body = vi.mocked(prisma.speakerMessage.create).mock.calls[0][0].data.body as string;
    expect(body).toContain("Mon, Nov 9 to Fri, Nov 13");
    expect(body).toContain("The week of the 2nd fell through.");
    expect(noticeGuestMessage).toHaveBeenCalledWith({ userId: "u9", email: "y@example.com" }, body);
  });

  it("needs a real range, and is exec only", async () => {
    expect((await ask({ from: "2026-11-13", to: "2026-11-09" })).status).toBe(400);
    expect((await ask({ from: "Nov 9" , to: "2026-11-13" })).status).toBe(400);
    as("BOARD");
    expect((await ask({ from: "2026-11-09", to: "2026-11-13" })).status).toBe(403);
    expect(prisma.speakerMessage.create).not.toHaveBeenCalled();
  });
});
