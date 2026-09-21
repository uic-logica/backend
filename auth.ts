import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

// Password login creates database sessions directly. Passwordless is archived,
// not registered: old provider callbacks cannot issue new sessions.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [],
  session: { strategy: "database" },
  callbacks: {
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
    // This runs for all password sessions created directly by
    // lib/session.ts (no sign-in provider involved)
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
