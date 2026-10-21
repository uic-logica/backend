import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { tell } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { PUT } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notify", () => ({ tell: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { membershipApplication: { findUnique: vi.fn(), update: vi.fn() }, user: { findMany: vi.fn(async () => [{ id: "exec1" }]) } },
}));

const params = { params: Promise.resolve({ id: "a1" }) };
const put = (body: unknown) => PUT(new NextRequest("http://localhost/api/join/mine/a1", { method: "PUT", body: JSON.stringify(body) }), params);
const window = { startDate: "2026-10-20", endDate: "2026-10-20", startTime: "14:00", endTime: "16:00" };
const app = (status = "INTERVIEW") => ({ id: "a1", name: "Ada", userId: null, email: "ada@uic.edu", status });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", email: "Ada@uic.edu" } } as never);
  vi.mocked(prisma.membershipApplication.findUnique).mockResolvedValue(app() as never);
});

describe("interview times from the dashboard", () => {
  it("saves for the applicant signed in with the application's email and tells the exec board", async () => {
    expect((await put({ availability: [window] })).status).toBe(200);
    expect(prisma.membershipApplication.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { interviewAvailability: [window], interviewAvailabilityAt: expect.any(Date) },
    });
    expect(tell).toHaveBeenCalledWith({ userId: "exec1" }, expect.stringContaining("Ada"), expect.any(String), expect.any(Object), "boardUpdates");
  });

  it("refuses someone else's application, the wrong step, and signed-out requests", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u2", email: "eve@uic.edu" } } as never);
    expect((await put({ availability: [window] })).status).toBe(404);
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", email: "ada@uic.edu" } } as never);
    vi.mocked(prisma.membershipApplication.findUnique).mockResolvedValue(app("PENDING") as never);
    expect((await put({ availability: [window] })).status).toBe(409);
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await put({ availability: [window] })).status).toBe(401);
    expect(prisma.membershipApplication.update).not.toHaveBeenCalled();
  });
});
