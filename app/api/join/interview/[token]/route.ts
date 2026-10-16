import { NextRequest, NextResponse } from "next/server";
import { applicationForInterview } from "@/lib/interview";
import { frontendOrigin } from "@/lib/linkedin-oauth";
import { tell } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { parseAvailability } from "@/lib/speaker-submission";

type Params = { params: Promise<{ token: string }> };
const gone = () =>
  NextResponse.json({ error: "This link isn't active anymore. If you still need to share times, reply to the board's email." }, { status: 404 });

/** Public with the private link: who this is for and the times they've shared so far. */
export async function GET(_request: NextRequest, { params }: Params) {
  const app = await applicationForInterview((await params).token);
  if (!app) return gone();
  return NextResponse.json({
    name: app.name,
    track: app.track,
    availability: app.interviewAvailability ?? [],
    savedAt: app.interviewAvailabilityAt,
  });
}

/** Save (or replace) the applicant's interview times, and tell the exec board. */
export async function PUT(request: NextRequest, { params }: Params) {
  const app = await applicationForInterview((await params).token);
  if (!app) return gone();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const parsed = parseAvailability((payload as { availability?: unknown })?.availability);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.windows.length) return NextResponse.json({ error: "Pick at least one time that works." }, { status: 400 });
  if (parsed.windows.length > 60) return NextResponse.json({ error: "That's a lot of separate times. Try fewer, longer blocks." }, { status: 400 });

  const savedAt = new Date();
  await prisma.membershipApplication.update({
    where: { id: app.id },
    data: { interviewAvailability: parsed.windows, interviewAvailabilityAt: savedAt },
  });

  const execs = await prisma.user.findMany({ where: { accountKind: "MEMBER", role: "EXEC_BOARD" }, select: { id: true } });
  const url = `${frontendOrigin()}/dashboard/applications?id=${app.id}`;
  await Promise.all(
    execs.map((e) =>
      tell({ userId: e.id }, `${app.name} shared their interview availability.`, `${app.name} shared interview times`, {
        eyebrow: "Applications",
        heading: `${app.name} shared their interview times`,
        paragraphs: ["Their times are on their application. Pick one and reach out to set up the interview."],
        button: { label: "Open the application", url },
      }),
    ),
  );
  return NextResponse.json({ availability: parsed.windows, savedAt });
}
