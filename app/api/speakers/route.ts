import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { clientKey, overAttemptLimit } from "@/lib/rate-limit";
import { parseFreshSubmission } from "@/lib/speaker-submission";

// logica-lean: bare-minimum speaker/guest intake (frontend#36). No email
// receipt on submit, no admin notification — whoever needs those picks it
// up as a follow-up.

/** Board+ only — the full submission list, including contact info and draft status. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasRole(session.user.role, "BOARD")) {
    return NextResponse.json({ error: "Only board members can view speaker submissions." }, { status: 403 });
  }

  const submissions = await prisma.speakerSubmission.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(submissions);
}

/** Public, no auth — a stranger filling out the form cold, start to finish. Rate-limited per IP. */
export async function POST(request: NextRequest) {
  if (overAttemptLimit(`speaker-submit:${clientKey(request)}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many submissions. Try again later." }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = parseFreshSubmission(payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const submission = await prisma.speakerSubmission.create({
    data: { ...parsed.data, submittedAt: new Date() },
  });
  return NextResponse.json({ id: submission.id }, { status: 201 });
}
