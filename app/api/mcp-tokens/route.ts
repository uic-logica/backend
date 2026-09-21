import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { mintToken } from "@/lib/mcp-token";
import { toolSummary } from "@/lib/mcp-tools";
import { prisma } from "@/lib/prisma";
import { STAGE_LABELS, stageOf } from "@/lib/stage";

const MAX_PER_USER = 5;

async function me() {
  const session = await auth();
  if (!session?.user) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      role: true,
      accountKind: true,
      speakerSubmission: { select: { status: true } },
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    stage: stageOf(user.accountKind, user.role, user.speakerSubmission?.status ?? null),
  };
}

/** Your own agent connections, plus what your agent would be able to do. */
export async function GET() {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const tokens = await prisma.mcpToken.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    // Never the hash: it's not secret-equivalent, but there's no reason to
    // put it on the wire either.
    select: { id: true, name: true, createdAt: true, lastUsedAt: true },
  });

  return NextResponse.json({
    stage: user.stage,
    role: STAGE_LABELS[user.stage],
    tokens,
    tools: toolSummary(user.stage),
  });
}

/** Mints a token. The secret is in this response and nowhere else, ever. */
export async function POST(request: NextRequest) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const raw = (payload as Record<string, unknown>)?.name;
  const name = (typeof raw === "string" ? raw.trim() : "") || "My agent";
  if (name.length > 60) {
    return NextResponse.json({ error: "Name must be 60 characters or fewer." }, { status: 400 });
  }

  const live = await prisma.mcpToken.count({ where: { userId: user.id, revokedAt: null } });
  if (live >= MAX_PER_USER) {
    return NextResponse.json(
      { error: `You can have ${MAX_PER_USER} connections at a time. Revoke one first.` },
      { status: 409 },
    );
  }

  const { secret, tokenHash } = mintToken();
  const token = await prisma.mcpToken.create({
    data: { userId: user.id, name, tokenHash },
    select: { id: true, name: true, createdAt: true },
  });

  return NextResponse.json({ ...token, secret }, { status: 201 });
}
