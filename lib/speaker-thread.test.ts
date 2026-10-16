import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { linkGuests, separateGuest, threadLead } from "./speaker-thread";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    speakerSubmission: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    speakerMessage: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
const find = vi.mocked(prisma.speakerSubmission.findUnique);

beforeEach(() => vi.clearAllMocks());

describe("shared speaker threads", () => {
  it("resolves a linked guest to the lead's thread", async () => {
    find.mockResolvedValueOnce({ id: "lucas", threadId: "jona" } as never);
    expect(await threadLead("lucas")).toBe("jona");
    find.mockResolvedValueOnce({ id: "jona", threadId: null } as never);
    expect(await threadLead("jona")).toBe("jona");
  });

  it("links a solo guest: messages move to the lead, the lead's event carries over", async () => {
    find
      .mockResolvedValueOnce({ id: "jona", threadId: null } as never)
      .mockResolvedValueOnce({ id: "lucas", threadId: null, eventId: null, _count: { sharing: 0 } } as never);
    vi.mocked(prisma.speakerSubmission.findUniqueOrThrow).mockResolvedValue({ eventId: "ev1" } as never);
    expect(await linkGuests("jona", "lucas")).toEqual({ lead: "jona" });
    expect(prisma.speakerMessage.updateMany).toHaveBeenCalledWith({ where: { submissionId: "lucas" }, data: { submissionId: "jona" } });
    expect(prisma.speakerSubmission.update).toHaveBeenCalledWith({ where: { id: "lucas" }, data: { threadId: "jona", eventId: "ev1" } });
  });

  it("refuses a guest who's already in a group, or the same guest", async () => {
    expect(await linkGuests("jona", "jona")).toMatchObject({ status: 400 });
    find
      .mockResolvedValueOnce({ id: "jona", threadId: null } as never)
      .mockResolvedValueOnce({ id: "mira", threadId: "kai", eventId: null, _count: { sharing: 0 } } as never);
    expect(await linkGuests("jona", "mira")).toMatchObject({ status: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("separates one member, or everyone when it's the lead", async () => {
    find.mockResolvedValueOnce({ threadId: "jona" } as never);
    await separateGuest("lucas");
    expect(prisma.speakerSubmission.updateMany).toHaveBeenLastCalledWith({ where: { id: "lucas" }, data: { threadId: null } });
    find.mockResolvedValueOnce({ threadId: null } as never);
    await separateGuest("jona");
    expect(prisma.speakerSubmission.updateMany).toHaveBeenLastCalledWith({ where: { threadId: "jona" }, data: { threadId: null } });
  });
});
