import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import * as attendance from "./attendance/route";
import * as checkInCode from "./check-in-code/route";

const params = { params: Promise.resolve({ id: "event-1" }) };
const request = () =>
  new NextRequest("http://localhost/api/events/event-1", {
    method: "POST",
    body: JSON.stringify({ email: "someone@uic.edu" }),
  });

// Rejected before any database call, so no database is needed.
const boardOnly = [
  ["GET check-in-code", () => checkInCode.GET(request(), params)],
  ["POST check-in-code", () => checkInCode.POST(request(), params)],
  ["GET attendance", () => attendance.GET(request(), params)],
  ["POST attendance", () => attendance.POST(request(), params)],
] as const;

describe.each(boardOnly)("%s", (_name, call) => {
  beforeEach(() => vi.mocked(auth).mockReset());

  it("rejects a MEMBER", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "MEMBER" }, expires: "" } as never);
    expect((await call()).status).toBe(403);
  });

  it("rejects a signed-out request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await call()).status).toBe(401);
  });
});
