import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => ({ prisma: { subscriber: { upsert: vi.fn() } } }));

function request(email: string) {
  return new NextRequest("http://localhost/api/subscribe", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "uic.edu");
});

describe("POST /api/subscribe", () => {
  it("rejects an address outside the allowed domain", async () => {
    const response = await POST(request("person@example.com"));

    expect(response.status).toBe(400);
    expect(prisma.subscriber.upsert).not.toHaveBeenCalled();
  });

  it("normalizes and stores an allowed address", async () => {
    const response = await POST(request(" Person@UIC.EDU "));

    expect(response.status).toBe(200);
    expect(prisma.subscriber.upsert).toHaveBeenCalledWith({
      where: { email: "person@uic.edu" },
      update: {},
      create: { email: "person@uic.edu" },
    });
  });

  it("uses the same no-op upsert and response for repeat submissions", async () => {
    const first = await POST(request("person@uic.edu"));
    const repeat = await POST(request("person@uic.edu"));

    expect(prisma.subscriber.upsert).toHaveBeenCalledTimes(2);
    expect({ status: repeat.status, body: await repeat.json() }).toEqual({
      status: first.status,
      body: await first.json(),
    });
  });
});
