import { NextRequest, NextResponse } from "next/server";
import { applicationForInterview, saveInterviewTimes } from "@/lib/interview";

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
  return saveInterviewTimes(app, payload);
}
