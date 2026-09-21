import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PATCH } from "./route";
import * as messages from "../speakers/[id]/messages/route";

function signedInAs(user: Record<string, unknown> | null) {
  vi.mocked(auth).mockResolvedValue(user ? ({ user, expires: "" } as never) : (null as never));
}

const patch = (body: unknown) =>
  PATCH(new NextRequest("http://localhost/api/speaker-profile", { method: "PATCH", body: JSON.stringify(body) }));

// Rejected before any database call, so no database is needed.
describe("speaker-profile PATCH", () => {
  it("rejects a signed-out request", async () => {
    signedInAs(null);
    expect((await patch({ bio: "hi" })).status).toBe(401);
  });

  it("rejects a MEMBER account", async () => {
    signedInAs({ id: "u1", role: "MEMBER", accountKind: "MEMBER" });
    expect((await patch({ bio: "hi" })).status).toBe(403);
  });
});

describe("speaker thread access", () => {
  const params = { params: Promise.resolve({ id: "any-submission" }) };

  it("rejects a plain MEMBER", async () => {
    signedInAs({ id: "u1", role: "MEMBER", accountKind: "MEMBER" });
    expect((await messages.GET(new NextRequest("http://localhost/x"), params)).status).toBe(403);
  });

  it("rejects a signed-out request", async () => {
    signedInAs(null);
    expect((await messages.GET(new NextRequest("http://localhost/x"), params)).status).toBe(401);
  });
});

/**
 * The candidate/speaker split, against the real schema: a guest we haven't
 * confirmed can offer availability but cannot start preparing a talk we
 * never agreed to. Hiding the fields in the UI isn't the control — this is.
 */
describe.skipIf(!process.env.DATABASE_URL)("talk details unlock on confirmation", () => {
  const prefix = `stage-test-${process.pid}`;

  beforeAll(async () => {
    await prisma.speakerSubmission.create({
      data: { id: prefix, name: "Stage Test", email: `${prefix}@example.com`, status: "PENDING", submittedAt: new Date() },
    });
    await prisma.user.create({
      data: {
        id: prefix,
        email: `${prefix}@example.com`,
        accountKind: "SPEAKER",
        username: prefix,
        speakerSubmissionId: prefix,
      },
    });
    signedInAs({ id: prefix, role: "MEMBER", accountKind: "SPEAKER" });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: prefix } });
    await prisma.speakerSubmission.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  it("lets a candidate save availability", async () => {
    const response = await patch({
      availability: [{ startDate: "2026-11-05", endDate: "2026-11-07", startTime: "13:00", endTime: "17:00" }],
    });
    expect(response.status).toBe(200);
  });

  it("refuses a talk title from a candidate", async () => {
    const response = await patch({ talkTitle: "Not agreed yet" });
    expect(response.status).toBe(403);
    expect(await prisma.speakerSubmission.findUnique({ where: { id: prefix } })).toMatchObject({ talkTitle: null });
  });

  it("refuses a slides link from a candidate", async () => {
    expect((await patch({ slidesUrl: "https://example.com/deck" })).status).toBe(403);
  });

  it("accepts both once the board confirms them", async () => {
    await prisma.speakerSubmission.update({ where: { id: prefix }, data: { status: "CONFIRMED" } });
    const response = await patch({ talkTitle: "Shipping real systems", slidesUrl: "https://example.com/deck" });
    expect(response.status).toBe(200);
    expect(await prisma.speakerSubmission.findUnique({ where: { id: prefix } })).toMatchObject({
      talkTitle: "Shipping real systems",
      slidesUrl: "https://example.com/deck",
    });
  });
});
