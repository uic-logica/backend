import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Public, no auth — confirmed speakers who opted in. Name/org only, no contact info. */
export async function GET() {
  const speakers = await prisma.speakerSubmission.findMany({
    where: { status: "CONFIRMED", publicOptIn: true },
    select: { id: true, name: true, organization: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(speakers);
}
