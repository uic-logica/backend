import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createLinkedInState, LINKEDIN_STATE_COOKIE, linkedInRedirectUri } from "@/lib/linkedin-oauth";

function config() {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const secret = process.env.AUTH_SECRET;
  return clientId && clientSecret && secret ? { clientId, redirectUri: linkedInRedirectUri(), secret } : null;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const settings = config();
  if (!settings) {
    return NextResponse.json(
      { error: "LinkedIn connection is not configured. Set LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, and AUTH_SECRET." },
      { status: 503 },
    );
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
