import { NextRequest, NextResponse } from "next/server";

import { handlers } from "@/auth";
import { isAllowedEmail, OTP_MAX_AGE_SECONDS } from "@/lib/otp";
import { clearAttempts, overAttemptLimit } from "@/lib/rate-limit";

/**
 * Exchanges an emailed sign-in code for a session cookie.
 *
 *   POST /api/auth/otp/verify   { "email": "you@uic.edu", "code": "123456" }
 *
 * Auth.js only redeems a code through `GET /api/auth/callback/nodemailer`,
 * which is shaped for a link in an email: it 302s and sets a cookie. The
 * frontend is a separate app collecting the code in a form, and it cannot
 * usefully follow that redirect, so this hands it back a JSON answer instead.
 *
 * The verification itself is still Auth.js's — this builds the callback request
 * and forwards its `Set-Cookie` untouched, so single-use tokens, expiry, the
 * `signIn` callback, and session creation all keep behaving exactly as they do
 * for a clicked link. Nothing here re-implements token checking.
 */

/** Wrong guesses allowed per address before the rest of the window is refused. */
const MAX_ATTEMPTS = 5;

const OTP_PATTERN = /^\d{6}$/;

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { email, code } = (payload ?? {}) as { email?: unknown; code?: unknown };

  if (typeof email !== "string" || typeof code !== "string") {
    return NextResponse.json(
      { error: "Both `email` and `code` are required." },
      { status: 400 },
    );
  }

  const identifier = email.trim().toLowerCase();

  // Same rule the signIn callback enforces; checked here so a wrong-domain
  // address never reaches the redemption path or burns an attempt slot.
  if (!isAllowedEmail(identifier) || !OTP_PATTERN.test(code)) {
    return NextResponse.json({ error: "That code isn't valid." }, { status: 401 });
  }

  if (overAttemptLimit(identifier, MAX_ATTEMPTS, OTP_MAX_AGE_SECONDS * 1000)) {
    return NextResponse.json(
      { error: "Too many attempts. Request a new code." },
      { status: 429 },
    );
  }

  const callback = new URL("/api/auth/callback/nodemailer", request.nextUrl.origin);
  callback.searchParams.set("token", code);
  callback.searchParams.set("email", identifier);

  const result = await handlers.GET(
    new NextRequest(callback, { headers: request.headers }),
  );

  // Auth.js answers a bad or expired code with a redirect to its error page and
  // no session cookie, so the presence of the cookie is what success means.
  const cookies = result.headers.getSetCookie();
  const signedIn = cookies.some(
    (cookie) => /(^|\s)(__Secure-)?authjs\.session-token=/.test(cookie) &&
      !/(^|\s)(__Secure-)?authjs\.session-token=;/.test(cookie),
  );

  if (!signedIn) {
    return NextResponse.json(
      { error: "That code isn't valid or has expired." },
      { status: 401 },
    );
  }

  clearAttempts(identifier);

  const response = NextResponse.json({ ok: true });
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}
