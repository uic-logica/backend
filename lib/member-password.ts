import { prisma } from "./prisma";
import { generateMemberPassword, hashPassword } from "./password";

export function normalizeMemberEmail(value: unknown): string | null {
  const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
  if (typeof value !== "string" || !domain) return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) && email.endsWith(`@${domain}`)
    ? email : null;
}

/** Counts attempts atomically in Postgres, across restarts and instances. */
export async function allowPasswordAttempt(email: string): Promise<boolean> {
  const identifier = `password:${email}`;
  const rows = await prisma.$queryRaw<{ guesses: number }[]>`
    INSERT INTO "SignInLimit" ("identifier", "guesses", "windowEndsAt")
    VALUES (${identifier}, 1, NOW() + INTERVAL '15 minutes')
    ON CONFLICT ("identifier") DO UPDATE SET
      "guesses" = CASE WHEN "SignInLimit"."windowEndsAt" <= NOW() THEN 1
        ELSE LEAST("SignInLimit"."guesses" + 1, 11) END,
      "windowEndsAt" = CASE WHEN "SignInLimit"."windowEndsAt" <= NOW()
        THEN NOW() + INTERVAL '15 minutes' ELSE "SignInLimit"."windowEndsAt" END
    RETURNING "guesses"`;
  return rows[0].guesses <= 10;
}

/** Never accepts a caller-chosen password or role. Existing roles stay intact. */
export async function issueMemberPassword(email: string) {
  const password = generateMemberPassword();
  const passwordHash = hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    // Serialize issuance with login so a concurrent login cannot survive a reset.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${email}))`;
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing && existing.accountKind !== "MEMBER") throw new Error("NOT_MEMBER");
    const member = await tx.user.upsert({
      where: { email },
      create: { email, accountKind: "MEMBER", passwordHash },
      update: { passwordHash, mustChangePassword: false },
      select: { id: true, email: true },
    });
    await tx.session.deleteMany({ where: { userId: member.id } });
    await tx.mcpToken.updateMany({ where: { userId: member.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.verificationToken.deleteMany({ where: { identifier: email } });
    return member;
  });
  return { ...user, password };
}
