import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import * as items from "./items/route";
import * as item from "./items/[id]/route";
import * as budgets from "./budgets/route";

const params = { params: Promise.resolve({ id: "item-1" }) };
const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body) });

const signedInAs = (user: Record<string, unknown>) =>
  vi.mocked(auth).mockResolvedValue({ user, expires: "" } as never);

/**
 * Every one of these is rejected before a single database call, so none of
 * them needs a database.
 */
const boardOnly = [
  ["GET /api/board/items", () => items.GET(new NextRequest("http://localhost/api/board/items"))],
  [
    "POST /api/board/items",
    () => items.POST(post("http://localhost/api/board/items", { kind: "MONEY", title: "Pizza" })),
  ],
  [
    "PATCH /api/board/items/:id",
    () =>
      item.PATCH(
        new NextRequest("http://localhost/api/board/items/item-1", {
          method: "PATCH",
          body: JSON.stringify({ stage: "APPROVED" }),
        }),
        params,
      ),
  ],
  [
    "DELETE /api/board/items/:id",
    () =>
      item.DELETE(
        new NextRequest("http://localhost/api/board/items/item-1", { method: "DELETE" }),
        params,
      ),
  ],
  ["GET /api/board/budgets", () => budgets.GET()],
] as const;

describe.each(boardOnly)("%s is exec-only", (_name, call) => {
  beforeEach(() => vi.mocked(auth).mockReset());

  it("rejects a signed-out request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await call()).status).toBe(401);
  });

  it("rejects a plain MEMBER", async () => {
    signedInAs({ id: "u1", role: "MEMBER", accountKind: "MEMBER" });
    expect((await call()).status).toBe(403);
  });

  /**
   * BOARD sees the member view until that tier gets its own surface. The
   * money, the roster and the pipeline are closed to them server-side, not
   * merely absent from their sidebar. One edit to runsWorkspace in
   * lib/authz.ts widens this, and this test is what will say so.
   */
  it("rejects a BOARD member, who is on the member view for now", async () => {
    signedInAs({ id: "u9", role: "BOARD", accountKind: "MEMBER" });
    expect((await call()).status).toBe(403);
  });

  /**
   * The reason isBoardAccount exists. Role is meaningless on a SPEAKER
   * account (AUTH.md), so a bare hasRole check would let this through — and
   * a guest speaker would be reading the club's finances.
   */
  it("rejects a SPEAKER account even when its Role says BOARD", async () => {
    signedInAs({ id: "s1", role: "BOARD", accountKind: "SPEAKER" });
    expect((await call()).status).toBe(403);
  });

  it("rejects a SPEAKER account carrying EXEC_BOARD", async () => {
    signedInAs({ id: "s1", role: "EXEC_BOARD", accountKind: "SPEAKER" });
    expect((await call()).status).toBe(403);
  });
});

describe("POST /api/board/budgets is exec-only", () => {
  const call = () =>
    budgets.POST(
      post("http://localhost/api/board/budgets", {
        label: "Fall 2026",
        amountCents: 400000,
        startsAt: "2026-08-20",
        endsAt: "2026-12-20",
      }),
    );

  beforeEach(() => vi.mocked(auth).mockReset());

  it("rejects a signed-out request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await call()).status).toBe(401);
  });

  it("rejects a MEMBER", async () => {
    signedInAs({ id: "u1", role: "MEMBER", accountKind: "MEMBER" });
    expect((await call()).status).toBe(403);
  });

  /** A budget is the number everything else is measured against. */
  it("rejects a BOARD member who is not exec", async () => {
    signedInAs({ id: "u2", role: "BOARD", accountKind: "MEMBER" });
    expect((await call()).status).toBe(403);
  });

  it("rejects a SPEAKER carrying EXEC_BOARD", async () => {
    signedInAs({ id: "s1", role: "EXEC_BOARD", accountKind: "SPEAKER" });
    expect((await call()).status).toBe(403);
  });
});
