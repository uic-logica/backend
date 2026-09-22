import { NextResponse } from "next/server";

/** Retired role-switching bypass: all member sessions require a password. */
export async function GET() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
