import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import * as drafts from "../speakers/drafts/route";
import * as link from "../speakers/[id]/invite-link/route";
import * as claim from "./claim/route";

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "sub-1" }) };

const signedInAs = (user: Record<string, unknown>) =>
  vi.mocked(auth).mockResolvedValue({ user, expires: "" } as never);

/**
 * A guest link creates an account when it's clicked, so who can mint one is
 * the whole security boundary. All of these are refused before any database
 * call, so none of them needs a database.
 */
const boardOnly = [
  [
    "POST /api/speakers/drafts",
    () => drafts.POST(post("http://localhost/api/speakers/drafts", { name: "Ada" })),
  ],
  [
    "POST /api/speakers/:id/invite-link",
    () => link.POST(post("http://localhost/api/speakers/sub-1/invite-link", {}), params),
  ],
] as const;

describe.each(boardOnly)("%s is board-only", (_name, call) => {
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
   * The one that matters: a guest who already has a SPEAKER account must
   * not be able to mint links for other guests. Role is meaningless on a
   * SPEAKER row, so a bare hasRole check would have allowed this — which
   * is exactly what the old drafts route did.
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

/**
 * A guest link is single use, and claiming it swaps the session cookie. A
 * board member opening their own link to check it works would therefore
 * both sign themselves out and spend the guest's only link — so the claim
 * refuses while anyone is signed in, before it touches the database.
 */
describe("POST /api/invites/claim while signed in", () => {
  const call = () =>
    claim.POST(
      post("http://localhost/api/invites/claim", {
        token: "inv_whatever",
        name: "Grace",
        email: "grace@example.com",
        password: "correct horse battery",
      }),
    );

  beforeEach(() => vi.mocked(auth).mockReset());

  it.each([
    ["a board member", { id: "u1", role: "BOARD", accountKind: "MEMBER" }],
    ["an exec", { id: "u2", role: "EXEC_BOARD", accountKind: "MEMBER" }],
    ["a plain member", { id: "u3", role: "MEMBER", accountKind: "MEMBER" }],
    ["another guest", { id: "s1", role: "MEMBER", accountKind: "SPEAKER" }],
  ])("refuses %s rather than burning the link", async (_who, user) => {
    signedInAs(user);
    const res = await call();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ reason: "signed-in" });
  });
});

describe("POST /api/speakers/drafts validation", () => {
  beforeEach(() => vi.mocked(auth).mockReset());

  it("rejects a kind that isn't one of the three", async () => {
    signedInAs({ id: "u2", role: "BOARD", accountKind: "MEMBER" });
    const res = await drafts.POST(
      post("http://localhost/api/speakers/drafts", { name: "Ada", kind: "PANEL" }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("WORKSHOP") });
  });

  it("rejects a non-JSON body", async () => {
    signedInAs({ id: "u2", role: "BOARD", accountKind: "MEMBER" });
    const res = await drafts.POST(
      new NextRequest("http://localhost/api/speakers/drafts", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });
});
