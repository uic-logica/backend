import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createLinkedInState, frontendOrigin, LINKEDIN_STATE_COOKIE, linkedInRedirectUri } from "@/lib/linkedin-oauth";

function config() {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const secret = process.env.AUTH_SECRET;
  return clientId && clientSecret && secret ? { clientId, redirectUri: linkedInRedirectUri(), secret } : null;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  // A browser link, not a fetch: land on a real page instead of raw JSON.
  if (!session?.user) return NextResponse.redirect(new URL("/signin", frontendOrigin()));
  const settings = config();
  if (!settings) {
    console.error("LinkedIn connect is not configured: set LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET and AUTH_SECRET.");
    return NextResponse.redirect(new URL("/dashboard/profile?linkedin=error", frontendOrigin()));
  }

  const { state, cookie } = createLinkedInState(settings.secret);
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    state,
    scope: "openid profile email",
  }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set(LINKEDIN_STATE_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/api/linkedin/callback",
    maxAge: 10 * 60,
  });
  return response;
}
