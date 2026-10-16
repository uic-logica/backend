import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { noticeApplicant } from "@/lib/notices";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notices", () => ({ noticeApplicant: vi.fn(async () => true) }));
vi.mock("@/lib/prisma", () => ({ prisma: { membershipApplication: { findUnique: vi.fn() } } }));

const as = (role: string, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role, accountKind }, expires: "" } as never);
const post = () => POST(new NextRequest("http://localhost/api/join/a1/notify", { method: "POST" }), { params: Promise.resolve({ id: "a1" }) });
const app = { id: "a1", userId: "u9", email: "ada@uic.edu", track: "SOFTWARE_ENGINEER", status: "INTERVIEW", reviewNote: null, canReapply: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.membershipApplication.findUnique).mockResolvedValue(app as never);
});

describe("POST /api/join/:id/notify", () => {
  it("resends the current status email, even though the status didn't change", async () => {
    as("EXEC_BOARD");
    expect((await post()).status).toBe(200);
    expect(noticeApplicant).toHaveBeenCalledWith(app, "INTERVIEW", "", true, true);
  });

  it("is exec only, and refuses a pending application", async () => {
    for (const [role, kind] of [["MEMBER", "MEMBER"], ["BOARD", "MEMBER"], ["EXEC_BOARD", "SPEAKER"]]) {
      as(role, kind);
      expect((await post()).status).toBe(403);
    }
    expect(noticeApplicant).not.toHaveBeenCalled();
    as("EXEC_BOARD");
    vi.mocked(noticeApplicant).mockResolvedValueOnce(false);
    expect((await post()).status).toBe(409);
  });
});
