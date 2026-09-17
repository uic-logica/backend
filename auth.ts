import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { createTransport } from "nodemailer";
import { prisma } from "@/lib/prisma";
import { OTP_MAX_AGE_SECONDS, generateOtp, isAllowedEmail, otpEmail } from "@/lib/otp";

// `|| 587` (not `??`) so an empty EMAIL_SERVER_PORT="" falls back too.
const port = Number(process.env.EMAIL_SERVER_PORT) || 587;

const smtp = {
  host: process.env.EMAIL_SERVER_HOST,
  port,
  // 465 is implicit TLS; everything else (587, 25) starts plaintext and upgrades via STARTTLS.
  secure: port === 465,
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
};

/**
 * Two sign-in systems, one Auth.js instance — see AUTH.md for the full
 * design and why. MEMBER accounts (UIC .edu) use this Nodemailer provider,
 * unchanged. SPEAKER accounts (no .edu required) use a username + password
 * checked by `POST /api/auth/speaker-login` — deliberately NOT an Auth.js
 * Credentials provider; see lib/session.ts for why that doesn't work here.
 * `auth()` below reads either kind of session identically once it exists.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Nodemailer({
      server: smtp,
      from: process.env.EMAIL_FROM,
      maxAge: OTP_MAX_AGE_SECONDS,
      // Replaces the default 32-char magic-link token with a typeable code.
      // Auth.js stores only sha256(`${token}${AUTH_SECRET}`), so the existing
      // VerificationToken(identifier, token, expires) table is unchanged.
      generateVerificationToken: generateOtp,
      async sendVerificationRequest({ identifier, token, expires, provider }) {
        // Auth.js silently falls back to localhost:25 / its own no-reply address
        // when these are unset, so fail loudly instead of dropping codes.
        if (!process.env.EMAIL_SERVER_HOST || !process.env.EMAIL_FROM) {
          throw new Error("EMAIL_SERVER_HOST and EMAIL_FROM must be set to send sign-in codes");
        }

        // logica-lean: opportunistic sweep of dead tokens (the adapter only
        // deletes on use) keeps the unique index on `token` from filling up with
        // expired 6-digit hashes — revisit if this needs a real cron job.
        await prisma.verificationToken.deleteMany({ where: { expires: { lt: new Date() } } });

        const minutes = Math.round((expires.getTime() - Date.now()) / 60_000);
        const { subject, text, html } = otpEmail(token, minutes);
        const result = await createTransport(provider.server).sendMail({
          to: identifier,
          from: provider.from,
          subject,
          text,
          html,
        });

        const failed = [...(result.rejected ?? []), ...(result.pending ?? [])].filter(Boolean);
        if (failed.length) throw new Error(`Sign-in code could not be sent to ${failed.join(", ")}`);
      },
    }),
  ],
  session: { strategy: "database" },
  callbacks: {
    // Runs twice per sign-in: once before the code is emailed, once when it is
    // redeemed. Both must pass, so a non-.edu address never receives a code.
    // SPEAKER accounts never reach this provider at all (see above), but the
    // check stays as a second line of defense in case that ever changes.
    async signIn({ user }) {
      if (user.accountKind === "SPEAKER") return false;
      return isAllowedEmail(user.email);
    },
    // Build the response explicitly instead of returning `session`.
    //
    // On the database strategy Auth.js hands this callback `{ ...session, user }`
    // — the raw Session row plus every User column — and sends whatever we return
    // straight back as the /api/auth/session body. Returning `session` would
    // publish `sessionToken` to any script on the page, which is the exact value
    // the httpOnly cookie exists to keep away from JavaScript, along with columns
    // (bio, major, gradYear) the caller never asked for.
    //
    // The JWT strategy hard-codes a minimal object for this reason; the database
    // strategy leaves it to us. Add fields here deliberately, one at a time.
    //
    // This also runs for SPEAKER sessions created directly by
    // lib/session.ts — that path skips `signIn` above (no provider involved)
    // but still goes through the adapter's `getSessionAndUser`, which calls
    // this callback the same as any other session.
    async session({ session, user }) {
      return {
        expires: session.expires,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          accountKind: user.accountKind,
          username: user.username,
          mustChangePassword: user.mustChangePassword,
        },
      };
    },
  },
});
