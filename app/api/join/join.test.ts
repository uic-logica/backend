import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import * as list from "./route";
import * as review from "./[id]/route";

const params = { params: Promise.resolve({ id: "app-1" }) };
const request = () =>
  new NextRequest("http://localhost/api/join/app-1", { method: "PATCH", body: JSON.stringify({ status: "ACCEPTED" }) });

// Rejected before any database call, so no database is needed.
const boardOnly = [
  ["GET /api/join", () => list.GET()],
  ["PATCH /api/join/:id", () => review.PATCH(request(), params)],
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
