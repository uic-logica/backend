import { NextRequest, NextResponse } from "next/server";
import { jsonBody, requireBoard } from "@/lib/board-guard";
import { generateTempPassword, hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

/** Exec only: partner club accounts and the events each can see and edit. */
export async function GET() {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  const partners = await prisma.user.findMany({
    where: { accountKind: "PARTNER" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      eventAccess: { select: { event: { select: { id: true, title: true, startsAt: true } } } },
    },
  });
  return NextResponse.json(partners.map(({ eventAccess, ...p }) => ({ ...p, events: eventAccess.map((a) => a.event) })));
}

/**
 * Exec only: `{ name, email }` creates a partner club account, or resets the
 * password of an existing one. The temporary password is in this response
 * and nowhere else; the partner replaces it on first sign-in.
 */
export async function POST(request: NextRequest) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  const body = await jsonBody(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A club name and a valid email are required." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, accountKind: true } });
  if (existing && existing.accountKind !== "PARTNER") {
    return NextResponse.json({ error: "That email already belongs to a member or guest account." }, { status: 409 });
  }

  const tempPassword = generateTempPassword();
  const data = { name, passwordHash: hashPassword(tempPassword), mustChangePassword: true };
  const user = existing
    ? await prisma.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { userId: existing.id } });
        return tx.user.update({ where: { id: existing.id }, data });
      })
    : await prisma.user.create({ data: { ...data, email, username: email, accountKind: "PARTNER" } });

  return NextResponse.json(
    { id: user.id, name: user.name, email, tempPassword },
    { status: existing ? 200 : 201, headers: { "Cache-Control": "no-store" } },
  );
}
