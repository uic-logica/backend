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

// ponytail: passwordless sign-in only — Auth.js emails a 6-digit code, the user
// posts it back to /api/auth/callback/nodemailer?token=<code>&email=<email>.
// Sign-in is restricted to ALLOWED_EMAIL_DOMAIN and fails closed if it is unset.
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
    async signIn({ user }) {
      return isAllowedEmail(user.email);
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = user.role;
      }
      return session;
    },
  },
});
