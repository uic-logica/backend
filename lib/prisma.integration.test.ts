import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";

// CI owns a fresh Postgres service. No local database is assumed or contacted.
describe.skipIf(!process.env.CI || !process.env.DATABASE_URL)("User byte columns", () => {
  const email = `omit-test-${randomUUID()}@uic.edu`;
  afterAll(async () => { await prisma.user.deleteMany({ where: { email } }); await prisma.$disconnect(); });

  it("are left out of ordinary reads (the session lookup) but served on an explicit select", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const user = await prisma.user.create({ data: { email, photoData: bytes, photoMimeType: "image/png", resumeData: bytes } });
    const token = randomUUID();
    await prisma.session.create({ data: { userId: user.id, sessionToken: token, expires: new Date(Date.now() + 60_000) } });

    // What @auth/prisma-adapter's getSessionAndUser runs on every request.
    const session = await prisma.session.findUnique({ where: { sessionToken: token }, include: { user: true } });
    expect(session?.user.email).toBe(email);
    expect(session?.user).not.toHaveProperty("photoData");
    expect(session?.user).not.toHaveProperty("resumeData");

    const served = await prisma.user.findUnique({ where: { id: user.id }, select: { photoData: true, resumeData: true } });
    expect(served?.photoData).toEqual(bytes);
    expect(served?.resumeData).toEqual(bytes);
  });
});
