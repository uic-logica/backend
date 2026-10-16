import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tell } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { GET, PUT } from "./route";

vi.mock("@/lib/notify", () => ({ tell: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { membershipApplication: { findUnique: vi.fn(), update: vi.fn() }, user: { findMany: vi.fn(async () => [{ id: "exec1" }]) } },
}));

const params = { params: Promise.resolve({ token: "tok" }) };
const put = (body: unknown) => PUT(new NextRequest("http://localhost/api/join/interview/tok", { method: "PUT", body: JSON.stringify(body) }), params);
const window = { startDate: "2026-10-20", endDate: "2026-10-20", startTime: "14:00", endTime: "16:00" };
const app = (status = "INTERVIEW") => ({ id: "a1", name: "Ada", track: "SOFTWARE_ENGINEER", status, interviewAvailability: null, interviewAvailabilityAt: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.membershipApplication.findUnique).mockResolvedValue(app() as never);
});

describe("interview availability link", () => {
  it("looks the application up by the link's hash, never the raw token", async () => {
    const res = await GET(new NextRequest("http://localhost"), params);
    expect(res.status).toBe(200);
    const where = vi.mocked(prisma.membershipApplication.findUnique).mock.calls[0][0].where as { interviewTokenHash: string };
    expect(where.interviewTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(where.interviewTokenHash).not.toBe("tok");
  });

  it("saves the times and tells the exec board", async () => {
    expect((await put({ availability: [window] })).status).toBe(200);
    expect(prisma.membershipApplication.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { interviewAvailability: [window], interviewAvailabilityAt: expect.any(Date) },
    });
    expect(tell).toHaveBeenCalledWith({ userId: "exec1" }, expect.stringContaining("Ada"), expect.any(String), expect.objectContaining({ button: expect.objectContaining({ label: "Open the application" }) }), "boardUpdates");
  });

  it("refuses bad or empty times, and dead links", async () => {
    expect((await put({ availability: [] })).status).toBe(400);
    expect((await put({ availability: [{ ...window, startTime: "2pm" }] })).status).toBe(400);
    vi.mocked(prisma.membershipApplication.findUnique).mockResolvedValue(app("ACCEPTED") as never);
    expect((await put({ availability: [window] })).status).toBe(404);
    vi.mocked(prisma.membershipApplication.findUnique).mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost"), params)).status).toBe(404);
    expect(prisma.membershipApplication.update).not.toHaveBeenCalled();
  });
});
