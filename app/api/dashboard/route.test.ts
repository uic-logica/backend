import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

it("rejects a signed-out request", async () => {
  vi.mocked(auth).mockResolvedValue(null as never);
  expect((await GET()).status).toBe(401);
});

// Exercise the real schema and relations, using isolated fixtures in a test database.
describe.skipIf(!process.env.DATABASE_URL)("private dashboard activity", () => {
  const prefix = `dashboard-test-${process.pid}`;
  const own = `${prefix}-own`;
  const other = `${prefix}-other`;
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: own, email: `${own}@example.com`, passwordHash: "must-not-leak" },
        { id: other, email: `${other}@example.com` },
      ],
    });
    await prisma.event.create({
      data: { id: prefix, title: "Test event", startsAt: new Date() },
    });
    await prisma.form.create({
      data: { id: prefix, title: "Test form", slug: prefix },
    });
    await prisma.post.createMany({
      data: [
        { authorId: own, body: "My post" },
        { authorId: other, body: "Someone else's private history" },
      ],
    });
    await prisma.attendance.create({ data: { eventId: prefix, userId: own } });
    await prisma.rsvp.create({
      data: { eventId: prefix, userId: own, status: "GOING" },
    });
    await prisma.submission.createMany({
      data: [
        {
          formId: prefix,
          userId: own,
          data: { privateAnswer: "must-not-leak" },
        },
        { formId: prefix, userId: other, data: {} },
      ],
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [own, other] } } });
    await prisma.event.deleteMany({ where: { id: prefix } });
    await prisma.form.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });
  it.each([
    ["MEMBER", "MEMBER"],
    ["MEMBER", "EXEC_BOARD"],
    ["SPEAKER", "MEMBER"],
  ])(
    "returns only the signed-in user's history for %s / %s",
    async (accountKind, role) => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: own, accountKind, role },
        expires: "",
      } as never);
      const response = await GET();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.involvement).toEqual({
        eventsAttended: 1,
        postsMade: 1,
        formsSubmitted: 1,
      });
      expect(body.posts.map((p: { body: string }) => p.body)).toEqual([
        "My post",
      ]);
      expect(body.rsvps).toEqual([{ eventId: prefix, status: "GOING" }]);
      expect(body.attendances).toHaveLength(1);
      expect(body.submissions).toHaveLength(1);
      expect(JSON.stringify(body)).not.toContain("must-not-leak");
      expect(JSON.stringify(body)).not.toContain(other);
    },
  );
});
