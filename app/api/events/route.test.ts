import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { event: { create: vi.fn(), findMany: vi.fn() } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "board-1", role: "BOARD" }, expires: "" } as never);
});

describe("POST /api/events", () => {
  it("rejects a public link with a non-http scheme", async () => {
    const response = await POST(new NextRequest("http://localhost/api/events", {
      method: "POST",
      body: JSON.stringify({
        title: "Club event",
        startsAt: "2026-10-01T18:00:00.000Z",
        link: "javascript:alert(1)",
      }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "`link` must be an http or https URL." });
    expect(prisma.event.create).not.toHaveBeenCalled();
  });
});
