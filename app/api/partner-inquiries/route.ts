import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { FIRST_STAGE, validStage } from "@/lib/board-item";
import { prisma } from "@/lib/prisma";
import { clientKey, overAttemptLimit } from "@/lib/rate-limit";

const MAX_SHORT = 100;
const MAX_LONG = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function requiredText(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error(`\`${field}\` is required (under ${max} characters).`);
  }
  return value.trim();
}

function optionalLink(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > MAX_LONG) {
    throw new Error(`\`link\` must be under ${MAX_LONG} characters.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("`link` must be a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("`link` must start with http:// or https://.");
  }
  return parsed.toString();
}

/** Public, no sign-in: puts a prospective partner into the board's existing outreach pipeline. */
export async function POST(request: NextRequest) {
  // Five submissions per IP per hour keeps this public write from becoming a pipeline spam funnel.
  if (overAttemptLimit(`partner-inquiry:${clientKey(request)}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many submissions. Try again later." }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  let data: Prisma.BoardItemUncheckedCreateInput;
  try {
    const body = (payload ?? {}) as Record<string, unknown>;
    const organisation = requiredText(body.organisation, "organisation", MAX_SHORT);
    const contactName = requiredText(body.contactName, "contactName", MAX_SHORT);
    const contactEmail = requiredText(body.contactEmail, "contactEmail", MAX_SHORT).toLowerCase();
    const detail = requiredText(body.message, "message", MAX_LONG);
    const link = optionalLink(body.link);
    // Partners are external, so the UIC-only isAllowedEmail check must not be used here.
    if (!EMAIL_RE.test(contactEmail)) throw new Error("`contactEmail` must be a valid email address.");

    const kind = "OUTREACH" as const;
    const stage = FIRST_STAGE[kind];
    if (!validStage(kind, stage)) throw new Error("The outreach pipeline is misconfigured.");

    data = {
      kind,
      stage,
      title: organisation,
      org: organisation,
      contactName,
      contactEmail,
      detail,
      link,
      channel: "Website",
      createdById: null,
    };
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  try {
    await prisma.boardItem.create({ data });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Couldn't save that inquiry. Try again." }, { status: 500 });
  }
}
