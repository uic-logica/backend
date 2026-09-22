import { NextRequest, NextResponse } from "next/server";
import { isAllowedEmail } from "@/lib/otp";
import { prisma } from "@/lib/prisma";
import { clientKey, overAttemptLimit } from "@/lib/rate-limit";

/** Public capture endpoint; ten attempts per IP per hour allows corrections without permitting bulk writes. */
export async function POST(request: NextRequest) {
  if (overAttemptLimit(`subscribe:${clientKey(request)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const rawEmail = (payload as { email?: unknown } | null)?.email;
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!isAllowedEmail(email)) {
    return NextResponse.json({ error: "A valid UIC email is required." }, { status: 400 });
  }

  await prisma.subscriber.upsert({
    where: { email },
    update: {},
    create: { email },
  });
  return NextResponse.json({ ok: true });
}
