import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Email codes are unavailable. Sign in with your issued password." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
