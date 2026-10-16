import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import { logEmail } from "@/lib/email-log";
import { notifyUser } from "@/lib/notify";
import { GET } from "./route";

vi.mock("@/lib/mailer", () => ({ sendMail: vi.fn() }));
vi.mock("@/lib/email-log", () => ({ logEmail: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    emailPreference: { findUnique: vi.fn() },
    notification: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

const exec = { email: "ana@uic.edu", role: "EXEC_BOARD", accountKind: "MEMBER" };
const run = () => GET(new NextRequest("http://localhost/api/cron/daily-summary"));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  vi.mocked(prisma.emailPreference.findUnique).mockResolvedValue(null);
});

describe("held for the summary", () => {
  it("an exec's applicant update waits for 9 AM; a message emails now; off sends nothing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(exec as never);
    await notifyUser("e1", "Alexis shared their interview times.", "boardUpdates");
    expect(prisma.notification.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ emailLater: true }) });
    expect(sendMail).not.toHaveBeenCalled();

    await notifyUser("e1", "Mira wrote in their thread.", "guestReplies");
    expect(prisma.notification.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ emailLater: false }) });
    expect(sendMail).toHaveBeenCalledOnce();

    vi.mocked(prisma.emailPreference.findUnique).mockResolvedValue({ modes: { guestReplies: "OFF" } } as never);
    await notifyUser("e1", "Mira wrote again.", "guestReplies");
    expect(sendMail).toHaveBeenCalledOnce();
    expect(logEmail).toHaveBeenCalledWith(expect.objectContaining({ status: "SKIPPED" }));
  });
});

describe("GET /api/cron/daily-summary", () => {
  it("sends one email per person with everything waiting, then clears it", async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([
      { id: "n1", userId: "e1", message: "Alexis shared their interview times.", createdAt: new Date("2026-10-15T20:00:00Z"), user: { email: "ana@uic.edu" } },
      { id: "n2", userId: "e1", message: "Alexis shared their interview times.", createdAt: new Date("2026-10-15T21:00:00Z"), user: { email: "ana@uic.edu" } },
      { id: "n3", userId: "e2", message: "Leo sent a blog post for review", createdAt: new Date("2026-10-15T22:00:00Z"), user: { email: "leo@uic.edu" } },
    ] as never);
    expect(await (await run()).json()).toEqual({ sent: 2, items: 3 });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "ana@uic.edu", subject: "Your LOGICA summary: 2 updates" }));
    expect(vi.mocked(sendMail).mock.calls[0][0].text).toContain("Thu 3:00 PM: Alexis shared their interview times.");
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["n1", "n2"] } }, data: { emailLater: false } });
  });

  it("sends nothing when nothing is waiting, and only answers Vercel's cron", async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);
    expect(await (await run()).json()).toEqual({ sent: 0, items: 0 });
    expect(sendMail).not.toHaveBeenCalled();
    process.env.CRON_SECRET = "s";
    expect((await run()).status).toBe(401);
  });
});
