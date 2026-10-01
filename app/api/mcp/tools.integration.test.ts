import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mintToken } from "@/lib/mcp-token";
import { TOOLS } from "@/lib/mcp-tools";
import { type Stage } from "@/lib/stage";
import { POST } from "./route";

/**
 * Every MCP tool, called the way an agent calls it — a bearer token per
 * stage, JSON-RPC through the route — against the real schema. The other
 * MCP tests cover auth and who sees what; this one proves the tools run.
 *
 * CI only: `announce` notifies every member, so this never runs against a
 * database with real people in it.
 */
describe.skipIf(!process.env.CI || !process.env.DATABASE_URL)("MCP tools end to end", () => {
  const tag = `mcp-e2e-${process.pid}`;
  const tokens = {} as Record<Stage, string>;
  const ids = {} as Record<"event" | "member" | "confirmed" | "pending", string>;
  const used = new Set<string>();
  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

  async function rpc(stage: Stage, name: string, args: Record<string, unknown> = {}) {
    const res = await POST(
      new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${tokens[stage]}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      }),
    );
    return (await res.json()) as { error?: { message: string }; result?: { isError?: boolean; content: { text: string }[] } };
  }

  /** Calls a tool that must succeed and returns its parsed payload. */
  async function call(stage: Stage, name: string, args: Record<string, unknown> = {}) {
    const body = await rpc(stage, name, args);
    expect(body.error, `${name} as ${stage}`).toBeUndefined();
    expect(body.result?.isError, `${name} as ${stage}: ${body.result?.content[0].text}`).toBeFalsy();
    used.add(name);
    return JSON.parse(body.result!.content[0].text);
  }

  async function refused(stage: Stage, name: string, args: Record<string, unknown> = {}) {
    const body = await rpc(stage, name, args);
    expect(!!body.error || !!body.result?.isError, `${name} must be refused for ${stage}`).toBe(true);
  }

  beforeAll(async () => {
    const event = await prisma.event.create({ data: { title: `${tag} talk`, location: "SCE 605", startsAt: new Date(Date.now() + 5 * 864e5) } });
    const window = (from: number, to: number) => [{ startDate: day(from), endDate: day(to), startTime: "10:00", endTime: "16:00" }];
    const confirmed = await prisma.speakerSubmission.create({
      data: { name: "Sam Speaker", email: `${tag}-sam@example.com`, status: "CONFIRMED", submittedAt: new Date(), eventId: event.id, availability: window(3, 9) },
    });
    const pending = await prisma.speakerSubmission.create({
      data: { name: "Casey Candidate", email: `${tag}-casey@example.com`, status: "PENDING", submittedAt: new Date(), availability: window(4, 12) },
    });
    const people: Record<Stage, Parameters<typeof prisma.user.create>[0]["data"]> = {
      MEMBER: { name: "Mia Member", email: `${tag}-mia@uic.edu` },
      BOARD: { name: "Bo Board", email: `${tag}-bo@uic.edu`, role: "BOARD" },
      EXEC_BOARD: { name: "Eli Exec", email: `${tag}-eli@uic.edu`, role: "EXEC_BOARD" },
      SPEAKER: { name: "Sam Speaker", email: `${tag}-sam@example.com`, accountKind: "SPEAKER", username: `${tag}-sam`, speakerSubmissionId: confirmed.id },
      CANDIDATE: { name: "Casey Candidate", email: `${tag}-casey@example.com`, accountKind: "SPEAKER", username: `${tag}-casey`, speakerSubmissionId: pending.id },
    };
    for (const [stage, data] of Object.entries(people) as [Stage, (typeof people)[Stage]][]) {
      const user = await prisma.user.create({ data });
      const { secret, tokenHash } = mintToken();
      await prisma.mcpToken.create({ data: { userId: user.id, name: tag, tokenHash } });
      tokens[stage] = secret;
      if (stage === "MEMBER") ids.member = user.id;
    }
    await prisma.membershipApplication.create({
      data: { name: "Ada Applicant", email: `${tag}-ada@uic.edu`, track: "BOARD_MEMBER", why: "I want to help run events and outreach for the club this year." },
    });
    Object.assign(ids, { event: event.id, confirmed: confirmed.id, pending: pending.id });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.speakerSubmission.deleteMany({ where: { OR: [{ email: { startsWith: tag } }, { name: `${tag} guest` }] } });
    await prisma.membershipApplication.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.boardItem.deleteMany({ where: { title: { startsWith: tag } } });
    await prisma.budget.deleteMany({ where: { label: { startsWith: tag } } });
    await prisma.event.deleteMany({ where: { title: { startsWith: tag } } });
    await prisma.$disconnect();
  });

  it("answers whoami for every stage", async () => {
    for (const stage of Object.keys(tokens) as Stage[]) expect((await call(stage, "whoami")).stage).toBe(stage);
  });

  it("runs the member tools", async () => {
    expect(await call("MEMBER", "list_events")).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.event })]));
    await call("MEMBER", "rsvp", { eventId: ids.event, status: "GOING" });
    expect((await call("MEMBER", "update_my_profile", { bio: "Testing the MCP", gradYear: 2028 })).gradYear).toBe(2028);
    await call("MEMBER", "post_to_feed", { body: `${tag} hello from an agent` });
    await call("MEMBER", "read_feed");
    expect((await call("MEMBER", "my_engagement")).postsMade).toBe(1);
  });

  it("runs the guest tools for a speaker and a candidate", async () => {
    for (const stage of ["SPEAKER", "CANDIDATE"] as const) {
      await call(stage, "get_my_visit");
      await call(stage, "set_availability", { windows: [{ startDate: day(6), endDate: day(14), startTime: "11:00", endTime: "15:00" }] });
      expect((await call(stage, "confirm_availability")).confirmedAt).toBeTruthy();
      await call(stage, "set_my_needs", { needs: "HDMI and a mic" });
      await call(stage, "message_board", { body: `Hi from ${stage}` });
      expect(await call(stage, "read_board_thread")).toHaveLength(1);
    }
    await call("SPEAKER", "set_talk", { talkTitle: "Agents in practice", slidesUrl: "https://example.com/slides" });
    expect((await call("SPEAKER", "get_talk_stats")).scheduled).toBe(true);
  });

  it("runs the exec board's guest pipeline", async () => {
    await call("EXEC_BOARD", "list_guests");
    await call("EXEC_BOARD", "list_guests", { readyToDecide: true });
    await call("EXEC_BOARD", "common_slots", { guestIds: [ids.confirmed, ids.pending] });
    await call("EXEC_BOARD", "reply_to_guest", { submissionId: ids.pending, body: "Thanks, we'll confirm soon." });
    const event = await call("EXEC_BOARD", "create_event", {
      title: `${tag} guest talk`,
      startsAt: new Date(Date.now() + 8 * 864e5).toISOString(),
      description: "📊 Line one\n🍕 Line two",
      link: "https://forms.gle/example",
    });
    expect(event.link).toBe("https://forms.gle/example");
    await call("EXEC_BOARD", "decide_on_guest", { submissionId: ids.pending, decision: "CONFIRMED" });
    expect((await call("EXEC_BOARD", "schedule_guest", { submissionId: ids.pending, eventId: event.id })).eventId).toBe(event.id);
    await call("EXEC_BOARD", "invite_guest", { name: `${tag} guest`, email: `${tag}-gina@example.com`, kind: "TALK" });
  });

  it("edits an event without touching what it wasn't sent", async () => {
    const before = await prisma.event.findUniqueOrThrow({ where: { id: ids.event } });
    const updated = await call("EXEC_BOARD", "update_event", { id: ids.event, description: "🔥 New line\n📍 Room 1413", link: "https://forms.gle/rsvp" });
    expect(updated).toMatchObject({ title: before.title, location: before.location, link: "https://forms.gle/rsvp" });
    const row = await prisma.event.findUniqueOrThrow({ where: { id: ids.event } });
    // Line breaks and emoji survive the round trip; the time didn't move.
    expect(row.description).toBe("🔥 New line\n📍 Room 1413");
    expect(row.startsAt.getTime()).toBe(before.startsAt.getTime());
    await call("EXEC_BOARD", "update_event", { id: ids.event, link: "" });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: ids.event } })).link).toBeNull();
    await refused("EXEC_BOARD", "update_event", { id: ids.event, link: "javascript:alert(1)" });
    await refused("EXEC_BOARD", "update_event", { id: ids.event, title: " " });
    await refused("EXEC_BOARD", "update_event", { id: "no-such-event", title: "x" });
    await refused("MEMBER", "update_event", { id: ids.event, title: "hijacked" });
  });

  it("re-derives the caller's stage on every call", async () => {
    // Casey was just confirmed, so the same token now carries the speaker tools…
    expect((await call("CANDIDATE", "whoami")).stage).toBe("SPEAKER");
    await call("EXEC_BOARD", "decide_on_guest", { submissionId: ids.pending, decision: "PENDING" });
    // …and loses them the moment the board moves her back.
    expect((await call("CANDIDATE", "whoami")).stage).toBe("CANDIDATE");
    await refused("CANDIDATE", "set_talk", { talkTitle: "Not agreed yet" });
  });

  it("runs the money and outreach board", async () => {
    const item = await call("EXEC_BOARD", "add_board_item", { kind: "MONEY", title: `${tag} pizza`, amountCents: 4200 });
    await call("EXEC_BOARD", "add_board_item", { kind: "OUTREACH", title: `${tag} sponsor`, org: "Acme" });
    await call("EXEC_BOARD", "list_board_items", { kind: "MONEY" });
    await call("EXEC_BOARD", "update_board_item", { id: item.id, detail: "Ordered" });
    await call("EXEC_BOARD", "set_budget", { label: `${tag} budget`, amountCents: 100000, startsAt: day(-30), endsAt: day(90) });
    await call("EXEC_BOARD", "budget_status");
    await call("EXEC_BOARD", "club_insights");
  });

  it("runs members, applications and check-in", async () => {
    await call("EXEC_BOARD", "list_members");
    await call("EXEC_BOARD", "list_members", { boardOnly: true });
    await call("EXEC_BOARD", "set_member_role", { id: ids.member, role: "MEMBER", officer: "OUTREACH" });
    const apps = await call("EXEC_BOARD", "list_applications", { pendingOnly: true });
    const mine = apps.find((a: { email: string }) => a.email === `${tag}-ada@uic.edu`);
    expect((await call("EXEC_BOARD", "decide_on_application", { id: mine.id, decision: "INTERVIEW" })).status).toBe("INTERVIEW");
    const { code } = await call("EXEC_BOARD", "open_check_in", { eventId: ids.event });
    await refused("MEMBER", "check_in", { code: "WRONG1" });
    expect((await call("MEMBER", "check_in", { code })).checkedIn).toBe(true);
    expect((await call("EXEC_BOARD", "event_attendance", { eventId: ids.event })).turnedUp).toBe(1);
  });

  it("runs announcements and notifications", async () => {
    await call("EXEC_BOARD", "announce", { message: `${tag} announcement` });
    const { notifications } = await call("MEMBER", "my_notifications", { unreadOnly: true });
    expect(notifications.some((n: { message: string }) => n.message === `${tag} announcement`)).toBe(true);
    await call("MEMBER", "mark_notification_read", { all: true });
    expect((await call("MEMBER", "my_notifications", { unreadOnly: true })).unread).toBe(0);
  });

  it("answers find_documents with Drive's explicit empty state when Drive isn't configured", async () => {
    const body = await rpc("EXEC_BOARD", "find_documents", { query: "budget" });
    expect(body.error).toBeUndefined();
    if (body.result?.isError) expect(body.result.content[0].text).toMatch(/Drive/);
    used.add("find_documents");
  });

  it("keeps the club's tools away from everyone else", async () => {
    await refused("MEMBER", "create_event", { title: "nope", startsAt: new Date().toISOString() });
    await refused("BOARD", "set_member_role", { id: ids.member, role: "EXEC_BOARD" });
    await refused("SPEAKER", "list_guests");
  });

  it("covered every tool in the registry", () => {
    expect([...used].sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });
});
