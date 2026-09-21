import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Manually creates an Auth.js-compatible database session and sets the
 * session cookie — used for all password login instead of NextAuth's
 * own Credentials-provider flow.
 *
 * Why: Auth.js v5's Credentials provider does not correctly create a
 * database Session row under `session: { strategy: "database" }` (verified
 * empirically — it issues a JWT-encoded cookie instead, which `auth()` then
 * can't resolve back to anything, so every request looks signed out). Two
 * NextAuth instances with different strategies was the other option; this
 * is simpler; it reuses the exact Session table / cookie shape the adapter
 * and `auth()` read, so every other route
 * in the app keeps working unmodified for both account kinds. See AUTH.md.
 */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // matches Auth.js's default

/** Creates the Session row and sets the cookie on `response` — pass the response you're about to return. */
export async function attachSession(
  userId: string,
  request: Request,
  response: NextResponse,
  db: Pick<Prisma.TransactionClient, "session"> = prisma,
): Promise<void> {
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await db.session.create({ data: { sessionToken, userId, expires } });

  const secure = new URL(request.url).protocol === "https:";
  const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";
  response.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires,
  });
}

// Keep the existing speaker call sites compatible.
export const attachSpeakerSession = attachSession;
