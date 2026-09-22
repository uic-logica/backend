import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import * as joinList from "./join/route";
import * as joinDecide from "./join/[id]/route";
import * as attendance from "./events/[id]/attendance/route";
import * as checkInCode from "./events/[id]/check-in-code/route";

const params = { params: Promise.resolve({ id: "x1" }) };
const signedInAs = (user: Record<string, unknown>) =>
  vi.mocked(auth).mockResolvedValue({ user, expires: "" } as never);
const get = (url: string) => new NextRequest(url);
const post = (url: string, body: unknown = {}) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body) });

/**
 * Role on its own is not enough. Role is meaningless on a SPEAKER account
 * (AUTH.md), so `hasRole(role, "BOARD")` alone would let a guest speaker
 * carrying a stray BOARD role read membership applications — which hold
 * someone's name, email and why they want to join — and open check-in
 * codes for events.
 *
 * AUTH.md says that account state should never exist, and nothing today
 * creates it. This is the belt: these four routes were the last ones still
 * checking Role without accountKind.
 */
const boardOnly = [
  ["GET /api/join", () => joinList.GET()],
  [
    "PATCH /api/join/:id",
    () =>
      joinDecide.PATCH(
        new NextRequest("http://localhost/api/join/x1", {
          method: "PATCH",
          body: JSON.stringify({ status: "ACCEPTED" }),
        }),
        params,
      ),
  ],
  ["GET /api/events/:id/attendance", () => attendance.GET(get("http://localhost/api/events/x1/attendance"), params)],
  [
    "POST /api/events/:id/attendance",
    () => attendance.POST(post("http://localhost/api/events/x1/attendance", { email: "a@uic.edu" }), params),
  ],
  ["GET /api/events/:id/check-in-code", () => checkInCode.GET(get("http://localhost/api/events/x1/check-in-code"), params)],
  ["POST /api/events/:id/check-in-code", () => checkInCode.POST(post("http://localhost/api/events/x1/check-in-code"), params)],
] as const;

describe.each(boardOnly)("%s rejects a SPEAKER account", (_name, call) => {
  beforeEach(() => vi.mocked(auth).mockReset());

  it("refuses a SPEAKER carrying role BOARD", async () => {
    signedInAs({ id: "s1", role: "BOARD", accountKind: "SPEAKER" });
    expect((await call()).status).toBe(403);
  });

  it("refuses a SPEAKER carrying role EXEC_BOARD", async () => {
    signedInAs({ id: "s1", role: "EXEC_BOARD", accountKind: "SPEAKER" });
    expect((await call()).status).toBe(403);
  });

  it("still refuses a plain MEMBER", async () => {
    signedInAs({ id: "u1", role: "MEMBER", accountKind: "MEMBER" });
    expect((await call()).status).toBe(403);
  });

  it("still refuses a signed-out request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await call()).status).toBe(401);
  });
});
