import { NextResponse } from "next/server";

/** JSON-only mutations plus an origin check protect browser session cookies. */
export function passwordRequestError(request: Request) {
  const origin = request.headers.get("origin");
  // Comma-separated so a domain move can list old, apex and www origins at once.
  const allowed = (process.env.FRONTEND_URL || new URL(request.url).origin).split(",").map((o) => o.trim());
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && !allowed.includes(origin))) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json({ error: "Expected application/json." }, { status: 415 });
  }
  return null;
}
