import { PrismaAdapter } from "@auth/prisma-adapter";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "./prisma";
import {
  MAX_CODES_PER_WINDOW,
  MAX_GUESSES_PER_CODE,
  allowCodeRequest,
  outOfGuesses,
  takeGuess,
  withGuessLimit,
} from "./sign-in-limit";

// Needs a migrated Postgres. CI provides one; locally, point DATABASE_URL at a throwaway database.
describe.skipIf(!process.env.DATABASE_URL)("sign-in limits", () => {
  const email = `limit-test-${process.pid}@uic.edu`;
  const adapter = withGuessLimit(PrismaAdapter(prisma));

  async function issueCode(token: string) {
    expect(await allowCodeRequest(email)).toBe(true);
    await adapter.createVerificationToken!({
      identifier: email,
      token,
      expires: new Date(Date.now() + 600_000),
    });
  }

  async function reset() {
    await prisma.signInLimit.deleteMany({ where: { identifier: email } });
    await prisma.verificationToken.deleteMany({ where: { identifier: email } });
  }

  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it("rejects the correct code once its guesses are used up", async () => {
    await issueCode("right");

    for (let i = 0; i < MAX_GUESSES_PER_CODE; i++) {
      expect(await adapter.useVerificationToken!({ identifier: email, token: "wrong" })).toBeNull();
    }
    expect(await outOfGuesses(email)).toBe(true);
    expect(await adapter.useVerificationToken!({ identifier: email, token: "right" })).toBeNull();
  });

  it("keeps the limit after a restart", async () => {
    await issueCode("right");
    for (let i = 0; i < MAX_GUESSES_PER_CODE; i++) await takeGuess(email);

    vi.resetModules();
    const fresh = await import("./sign-in-limit");
    const restarted = fresh.withGuessLimit(PrismaAdapter(prisma));
    expect(await restarted.useVerificationToken!({ identifier: email, token: "right" })).toBeNull();
  });

  it("accepts the correct code within the limit", async () => {
    await issueCode("right");
    await adapter.useVerificationToken!({ identifier: email, token: "wrong" });

    const token = await adapter.useVerificationToken!({ identifier: email, token: "right" });
    expect(token?.identifier).toBe(email);
  });

  it("counts parallel guesses without letting extras through", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => takeGuess(email)));
    expect(results.filter(Boolean)).toHaveLength(MAX_GUESSES_PER_CODE);
  });

  it("refuses a redemption with no email", async () => {
    await issueCode("right");
    const params = { identifier: undefined, token: "right" } as unknown as { identifier: string; token: string };
    expect(await adapter.useVerificationToken!(params)).toBeNull();
  });

  it("gives a new code a fresh budget and drops the old code", async () => {
    await issueCode("old");
    for (let i = 0; i < MAX_GUESSES_PER_CODE; i++) await takeGuess(email);

    await issueCode("new");
    expect(await outOfGuesses(email)).toBe(false);
    expect(await adapter.useVerificationToken!({ identifier: email, token: "old" })).toBeNull();
    expect(await adapter.useVerificationToken!({ identifier: email, token: "new" })).not.toBeNull();
  });

  it("caps codes per window, including parallel requests", async () => {
    const results = await Promise.all(
      Array.from({ length: MAX_CODES_PER_WINDOW + 5 }, () => allowCodeRequest(email)),
    );
    expect(results.filter(Boolean)).toHaveLength(MAX_CODES_PER_WINDOW);
    expect(await allowCodeRequest(email)).toBe(false);
  });

  it("allows codes again once the window ends", async () => {
    for (let i = 0; i < MAX_CODES_PER_WINDOW; i++) await allowCodeRequest(email);
    await prisma.signInLimit.update({ where: { identifier: email }, data: { windowEndsAt: new Date(0) } });
    expect(await allowCodeRequest(email)).toBe(true);
  });
});
