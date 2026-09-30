import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { notifyEventGoing } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyEventGoing: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { event: { findUnique: vi.fn() }, post: { create: vi.fn() } },
}));

const params = { params: Promise.resolve({ id: "event-1" }) };
const post = {
  id: "post-1",
  body: "Hello",
  authorId: "user-1",
  eventId: "event-1",
  createdAt: new Date("2026-09-29T12:00:00Z"),
  author: { id: "user-1", name: "Ada", role: "MEMBER" },
};

function request(body: unknown) {
  return new NextRequest("http://localhost/api/events/event-1/feed", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" }, expires: "" } as never);
  vi.mocked(prisma.event.findUnique).mockResolvedValue({ id: "event-1", title: "Demo Night" } as never);
  vi.mocked(prisma.post.create).mockResolvedValue(post as never);
});

describe("POST /api/events/:id/feed", () => {
  it("returns the created post when notification delivery fails", async () => {
    vi.mocked(notifyEventGoing).mockRejectedValue(new Error("mail unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ body: "Hello" }), params);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "post-1", body: "Hello" });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("rejects posts longer than 5,000 trimmed characters", async () => {
    const response = await POST(request({ body: ` ${"x".repeat(5001)} ` }), params);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Posts are limited to 5,000 characters." });
    expect(prisma.post.create).not.toHaveBeenCalled();
  });
});
