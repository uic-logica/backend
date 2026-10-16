import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { emailLog: { count: vi.fn() } } }));
const as = (role: string, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role, accountKind }, expires: "" } as never);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/board/emails/usage", () => {
  it("counts sent emails this month and today against Resend's free plan", async () => {
    as("EXEC_BOARD");
    vi.mocked(prisma.emailLog.count).mockResolvedValueOnce(42).mockResolvedValueOnce(7);
    expect(await (await GET()).json()).toEqual({ month: 42, monthLimit: 3000, day: 7, dayLimit: 100 });
    expect(prisma.emailLog.count).toHaveBeenCalledWith({ where: { status: "SENT", createdAt: { gte: expect.any(Date) } } });
  });

  it("is exec only", async () => {
    as("BOARD");
    expect((await GET()).status).toBe(403);
  });
});
