import { NextRequest, NextResponse } from "next/server";
import { jsonBody, requireBoard } from "@/lib/board-guard";
import { budgetRollup } from "@/lib/board-item";
import { prisma } from "@/lib/prisma";

/**
 * The pots of money the club has for a term, each with what's actually left.
 * The balance is computed on read, never stored — see budgetRollup().
 *
 * Reading is board-wide (everyone should know what's left). Creating one is
 * exec only: a budget is the number everything else is measured against.
 */
export async function GET() {
  const gate = await requireBoard();
  if (gate.error) return gate.error;

  const budgets = await prisma.budget.findMany({
    orderBy: { startsAt: "desc" },
    include: {
      items: { select: { stage: true, amountCents: true, paidByUserId: true }, where: { archivedAt: null } },
    },
  });

  // Spends that were never filed under a budget still left the account, so
  // they're reported separately rather than quietly dropped.
  const loose = await prisma.boardItem.findMany({
    where: { kind: "MONEY", budgetId: null, archivedAt: null },
    select: { stage: true, amountCents: true, paidByUserId: true },
  });

  return NextResponse.json({
    budgets: budgets.map(({ items, ...budget }) => ({
      ...budget,
      itemCount: items.length,
      ...budgetRollup(budget.amountCents, items),
    })),
    unbudgeted: budgetRollup(0, loose),
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireBoard("EXEC_BOARD");
  if (gate.error) return gate.error;

  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });

  const label = String(body.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "Give the budget a name." }, { status: 400 });

  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return NextResponse.json(
      { error: "Amounts are whole cents — 4000 dollars is 400000." },
      { status: 400 },
    );
  }

  const startsAt = new Date(String(body.startsAt ?? ""));
  const endsAt = new Date(String(body.endsAt ?? ""));
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return NextResponse.json({ error: "Give the term a start and end date." }, { status: 400 });
  }
  if (endsAt <= startsAt) {
    return NextResponse.json({ error: "The term has to end after it starts." }, { status: 400 });
  }

  const budget = await prisma.budget.create({
    data: { label: label.slice(0, 120), amountCents, startsAt, endsAt },
  });
  return NextResponse.json({ ...budget, ...budgetRollup(budget.amountCents, []) }, { status: 201 });
}
