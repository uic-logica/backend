import type { Adapter } from "next-auth/adapters";

import { prisma } from "./prisma";

/** Wrong guesses allowed against one code. The next guess is refused, even a correct one. */
export const MAX_GUESSES_PER_CODE = 5;

/** Codes one address can be sent per window. */
export const MAX_CODES_PER_WINDOW = 5;

/** Length of the code-request window, in seconds. */
export const CODE_WINDOW_SECONDS = 60 * 60;

function key(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Counts a code request for `email`. Returns `false` once the address is over
 * `MAX_CODES_PER_WINDOW`. When allowed, earlier codes for the address are
 * deleted and the guess budget resets, so every code gets its own budget.
 */
export async function allowCodeRequest(email: string): Promise<boolean> {
  const identifier = key(email);

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    // Raw so parallel first requests don't collide on create. 'epoch' means no window is open yet.
    await tx.$executeRaw`INSERT INTO "SignInLimit" ("identifier", "windowEndsAt") VALUES (${identifier}, 'epoch') ON CONFLICT DO NOTHING`;
    // Row lock, so parallel requests for one address are counted one at a time.
    await tx.$queryRaw`SELECT 1 FROM "SignInLimit" WHERE "identifier" = ${identifier} FOR UPDATE`;

    const limit = await tx.signInLimit.findUniqueOrThrow({ where: { identifier } });
    const windowOver = limit.windowEndsAt <= now;
    const codeRequests = windowOver ? 1 : limit.codeRequests + 1;

    if (codeRequests > MAX_CODES_PER_WINDOW) {
      await tx.signInLimit.update({ where: { identifier }, data: { codeRequests } });
      return false;
    }

    await tx.signInLimit.update({
      where: { identifier },
      data: {
        codeRequests,
        guesses: 0,
        windowEndsAt: windowOver ? new Date(now.getTime() + CODE_WINDOW_SECONDS * 1000) : undefined,
      },
    });
    await tx.verificationToken.deleteMany({ where: { identifier } });
    return true;
  });
}

/** Counts a guess for `email`. Returns `false` once the current code is out of guesses. */
export async function takeGuess(email: string): Promise<boolean> {
  const identifier = key(email);
  // Single upsert with an increment, so parallel guesses can't read the same count.
  const { guesses } = await prisma.signInLimit.upsert({
    where: { identifier },
    create: { identifier, guesses: 1, windowEndsAt: new Date() },
    update: { guesses: { increment: 1 } },
  });
  return guesses <= MAX_GUESSES_PER_CODE;
}

/** Whether the current code for `email` has used up its guesses. */
export async function outOfGuesses(email: string): Promise<boolean> {
  const limit = await prisma.signInLimit.findUnique({ where: { identifier: key(email) } });
  return (limit?.guesses ?? 0) >= MAX_GUESSES_PER_CODE;
}

/**
 * Wraps the adapter so every code redemption spends a guess. Auth.js redeems
 * codes only through `useVerificationToken`, so this covers both
 * `/api/auth/callback/nodemailer` and `/api/auth/otp/verify`.
 */
export function withGuessLimit(adapter: Adapter): Adapter {
  return {
    ...adapter,
    async useVerificationToken(params) {
      // Auth.js passes the `email` query param through and skips its own check
      // when it's missing. Without an address there's nothing to count against.
      if (typeof params.identifier !== "string" || !params.identifier) return null;
      if (!(await takeGuess(params.identifier))) return null;
      return adapter.useVerificationToken!(params);
    },
  };
}
