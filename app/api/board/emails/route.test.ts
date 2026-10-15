import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { emailLog: { findMany: vi.fn(), update: vi.fn() } } }));

const as = (role: string, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role, accountKind }, expires: "" } as never);
const sent = { id: "l1", to: "ana@uic.edu", subject: "You're going: LitCode", status: "SENT", providerId: "re_1", delivery: null, createdAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  vi.mocked(prisma.emailLog.findMany).mockResolvedValue([sent] as never);
});

describe("GET /api/board/emails", () => {
  it("is exec only", async () => {
    for (const [role, kind] of [["MEMBER", "MEMBER"], ["BOARD", "MEMBER"], ["EXEC_BOARD", "SPEAKER"]]) {
      as(role, kind);
      expect((await GET()).status).toBe(403);
    }
    expect(prisma.emailLog.findMany).not.toHaveBeenCalled();
  });

  it("returns the log and fills in delivery from Resend", async () => {
    as("EXEC_BOARD");
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ last_event: "delivered" })));
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await GET()).json();
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails/re_1", expect.anything());
    expect(body[0]).toMatchObject({ to: "ana@uic.edu", status: "SENT", delivery: "delivered" });
    expect(prisma.emailLog.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { delivery: "delivered" } });
  });
});
