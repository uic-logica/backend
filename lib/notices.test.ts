import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailTo, tell } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { renderEmail } from "./email-layout";
import { noticeExecsOfReply, noticeGuestDecision, noticeGuestMessage, noticeGuestScheduled, noticeRsvp } from "./notices";

vi.mock("@/lib/notify", () => ({ tell: vi.fn(), emailTo: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    emailPreference: { findUnique: vi.fn() },
    event: { findUnique: vi.fn() },
  },
}));

const guest = { userId: null, email: "mira@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ email: "ana@uic.edu" } as never);
  vi.mocked(prisma.emailPreference.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.event.findUnique).mockResolvedValue({ title: "LitCode", startsAt: new Date("2026-10-22T22:00:00Z"), location: "CDRLC 1413", link: null } as never);
});

describe("guest notices", () => {
  it("emails a decision once, and nothing for a move back to candidate", async () => {
    await noticeGuestDecision(guest, "PENDING", "CONFIRMED");
    expect(tell).toHaveBeenCalledWith(guest, expect.stringContaining("confirmed"), "You're confirmed to speak at LOGICA", expect.objectContaining({ heading: "You're speaking at LOGICA" }));
    vi.mocked(tell).mockClear();
    await noticeGuestDecision(guest, "CONFIRMED", "CONFIRMED");
    await noticeGuestDecision(guest, "CONFIRMED", "PENDING");
    expect(tell).not.toHaveBeenCalled();
  });

  it("says when and where a talk is, in Chicago time, or that the date is TBD", async () => {
    await noticeGuestScheduled(guest, { title: "Agents in prod", startsAt: new Date("2026-11-05T23:00:00Z"), location: "SELE 2252" });
    expect(tell).toHaveBeenLastCalledWith(
      guest,
      expect.stringContaining("Thursday, November 5 at 5:00 PM in SELE 2252"),
      expect.any(String),
      expect.objectContaining({ details: [["When", "Thursday, November 5 at 5:00 PM"], ["Where", "SELE 2252"]] }),
    );
    await noticeGuestScheduled(guest, { title: "Agents in prod", startsAt: null, location: null });
    expect(tell).toHaveBeenLastCalledWith(guest, expect.stringContaining("date TBD"), expect.any(String), expect.objectContaining({ details: [["When", "Date TBD"]] }));
  });

  it("carries the board's message to the guest, and a guest's reply to every exec", async () => {
    await noticeGuestMessage(guest, "Can you do 6 PM?");
    expect(tell).toHaveBeenCalledWith(guest, expect.stringContaining("Can you do 6 PM?"), "New message from LOGICA", expect.objectContaining({ quote: "Can you do 6 PM?" }));
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "e1" }, { id: "e2" }] as never);
    await noticeExecsOfReply("s1", "Mira", "Yes, 6 works");
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { accountKind: "MEMBER", role: "EXEC_BOARD" }, select: { id: true } });
    expect(tell).toHaveBeenCalledWith({ userId: "e2" }, expect.stringContaining("Yes, 6 works"), "Mira replied in their thread", expect.objectContaining({ quote: "Yes, 6 works" }));
  });
});

describe("RSVP confirmation", () => {
  it("emails the member when they first say they're going", async () => {
    await noticeRsvp("u1", "ev1", undefined);
    expect(emailTo).toHaveBeenCalledWith(
      "ana@uic.edu",
      "You're going: LitCode",
      expect.objectContaining({ heading: "You're going to LitCode", details: expect.arrayContaining([["Where", "CDRLC 1413"]]) }),
    );
  });

  it("stays quiet when they were already going or turned event emails off", async () => {
    await noticeRsvp("u1", "ev1", "GOING");
    vi.mocked(prisma.emailPreference.findUnique).mockResolvedValue({ eventReminders: false } as never);
    await noticeRsvp("u1", "ev1", "NOT_GOING");
    expect(emailTo).not.toHaveBeenCalled();
  });
});

describe("email layout", () => {
  it("escapes what people typed and keeps a plain-text copy", () => {
    const { html, text } = renderEmail({ heading: "Hi", paragraphs: [], quote: "<script>x</script> & more", button: { label: "Go", url: "https://logicauic.org" } });
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; more");
    expect(html).not.toContain("<script>");
    expect(text).toContain('"<script>x</script> & more"');
    expect(text).toContain("Go: https://logicauic.org");
  });
});
