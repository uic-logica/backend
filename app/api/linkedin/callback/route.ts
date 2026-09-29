import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { LINKEDIN_STATE_COOKIE, validateLinkedInImage, verifyLinkedInState } from "@/lib/linkedin-oauth";

type LinkedInUserInfo = { sub?: unknown; picture?: unknown };

function profileRedirect(result: "connected" | "error") {
  const frontend = process.env.FRONTEND_URL ?? "http://localhost:3000";
  return new URL(`/dashboard/profile?linkedin=${result}`, frontend);
}

function clearState(response: NextResponse) {
  response.cookies.set(LINKEDIN_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: response.url.startsWith("https:"),
    path: "/api/linkedin/callback",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const fail = () => clearState(NextResponse.redirect(profileRedirect("error")));
  const session = await auth();
  const secret = process.env.AUTH_SECRET;
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI;
  if (!session?.user || !secret || !clientId || !clientSecret || !redirectUri) return fail();

  const state = request.nextUrl.searchParams.get("state");
  if (!verifyLinkedInState(state, request.cookies.get(LINKEDIN_STATE_COOKIE)?.value, secret)) return fail();
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return fail();

  try {
    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    });
    if (!tokenResponse.ok) return fail();
    const token = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof token.access_token !== "string") return fail();

    const infoResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      cache: "no-store",
    });
    if (!infoResponse.ok) return fail();
    const info = (await infoResponse.json()) as LinkedInUserInfo;
    if (typeof info.sub !== "string" || typeof info.picture !== "string") return fail();

    const photoResponse = await fetch(info.picture, { cache: "no-store", redirect: "follow" });
    if (!photoResponse.ok) return fail();
    const declaredLength = Number(photoResponse.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 2 * 1024 * 1024) return fail();
    const photo = validateLinkedInImage(photoResponse.headers.get("content-type"), await photoResponse.arrayBuffer());
    if (!photo.ok) return fail();

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        linkedinSub: info.sub,
        photoUrl: `/api/photo/${session.user.id}?v=${Date.now()}`, // new URL per connect busts the 1h cache
        photoData: photo.data,
        photoMimeType: photo.mimeType,
      },
    });
    return clearState(NextResponse.redirect(profileRedirect("connected")));
  } catch {
    return fail();
  }
}
