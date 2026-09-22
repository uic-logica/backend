import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { allowPasswordAttempt, issueMemberPassword } from "./member-password";
import { hashPassword, verifyPassword } from "./password";

// CI owns a fresh Postgres service. No local database is assumed or contacted.
describe.skipIf(!process.env.CI || !process.env.DATABASE_URL)("member passwords in Postgres", () => {
  const email = `password-test-${randomUUID()}@uic.edu`;
  const identifier = `password:${email}`;
  async function reset() {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.signInLimit.deleteMany({ where: { identifier } });
    await prisma.verificationToken.deleteMany({ where: { identifier: email } });
  }
  beforeEach(reset);
  afterAll(async () => { await reset(); await prisma.$disconnect(); });

  it("allows exactly ten parallel attempts, retains the limit after reload, then expires", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => allowPasswordAttempt(email)));
    expect(results.filter(Boolean)).toHaveLength(10);
    vi.resetModules();
    const fresh = await import("./member-password");
    expect(await fresh.allowPasswordAttempt(email)).toBe(false);
    await prisma.signInLimit.update({ where: { identifier }, data: { windowEndsAt: new Date(0) } });
    expect(await allowPasswordAttempt(email)).toBe(true);
  });

  it("preserves exec role and profile while invalidating old credentials, sessions, and tokens", async () => {
    const user = await prisma.user.create({ data: {
      email, name: "Password test", role: "EXEC_BOARD", passwordHash: hashPassword("old-test-password"),
    } });
    await prisma.session.create({ data: { userId: user.id, sessionToken: randomUUID(), expires: new Date(Date.now() + 60_000) } });
    await prisma.mcpToken.create({ data: { userId: user.id, name: "test", tokenHash: randomUUID() } });
    await prisma.verificationToken.create({ data: { identifier: email, token: randomUUID(), expires: new Date(Date.now() + 60_000) } });
    const issued = await issueMemberPassword(email);
    const updated = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(updated.role).toBe("EXEC_BOARD");
    expect(updated.name).toBe("Password test");
    expect(verifyPassword(issued.password, updated.passwordHash!)).toBe(true);
    expect(verifyPassword("old-test-password", updated.passwordHash!)).toBe(false);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.mcpToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.verificationToken.count({ where: { identifier: email } })).toBe(0);
  });

  it("creates a member and does not overwrite guest credentials", async () => {
    const issued = await issueMemberPassword(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe("MEMBER");
    expect(verifyPassword(issued.password, user.passwordHash!)).toBe(true);
    await prisma.user.update({ where: { email }, data: { accountKind: "SPEAKER" } });
    await expect(issueMemberPassword(email)).rejects.toThrow("NOT_MEMBER");
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).passwordHash).toBe(user.passwordHash);
  });
});
