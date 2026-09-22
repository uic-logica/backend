import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { GET as getBoardItems } from "@/app/api/board/items/route";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { boardItem: { create: vi.fn(), findMany: vi.fn() } } }));

let requestNumber = 0;
const valid = {
  organisation: "Acme Labs",
  contactName: "Ada Lovelace",
  contactEmail: "ada@acme.example",
  message: "We would like to sponsor a workshop.",
};

function request(body: unknown) {
  requestNumber += 1;
  return new NextRequest("https://club.test/api/partner-inquiries", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${requestNumber}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.boardItem.create).mockResolvedValue({} as never);
});

describe("public partner inquiries", () => {
  it.each([
    {},
    { ...valid, organisation: "   " },
    { ...valid, contactName: "" },
    { ...valid, contactEmail: "" },
    { ...valid, message: "\n" },
  ])("rejects missing or blank required fields", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(prisma.boardItem.create).not.toHaveBeenCalled();
  });

  it.each([
    { ...valid, organisation: "x".repeat(101) },
    { ...valid, contactName: "x".repeat(101) },
    { ...valid, contactEmail: `${"x".repeat(90)}@example.com` },
    { ...valid, message: "x".repeat(2001) },
    { ...valid, link: `https://example.com/${"x".repeat(2000)}` },
  ])("rejects over-length fields", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(prisma.boardItem.create).not.toHaveBeenCalled();
  });

  it("rejects javascript links and accepts https links", async () => {
    expect((await POST(request({ ...valid, link: "javascript:alert(1)" }))).status).toBe(400);
    expect((await POST(request({ ...valid, link: "https://acme.example/partners" }))).status).toBe(201);
  });

  it("accepts a non-UIC email and creates only a website outreach prospect", async () => {
    const response = await POST(request({
      ...valid,
      link: "https://acme.example/partners",
      kind: "MONEY",
      stage: "PAID",
      ownerId: "attacker",
      amountCents: 900000,
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(prisma.boardItem.create).toHaveBeenCalledWith({
      data: {
        kind: "OUTREACH",
        stage: "PROSPECT",
        title: "Acme Labs",
        org: "Acme Labs",
        contactName: "Ada Lovelace",
        contactEmail: "ada@acme.example",
        detail: "We would like to sponsor a workshop.",
        link: "https://acme.example/partners",
        channel: "Website",
        createdById: null,
      },
    });
  });

  it("keeps the board item list private", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const response = await getBoardItems(new NextRequest("https://club.test/api/board/items"));
    expect(response.status).toBe(401);
    expect(prisma.boardItem.findMany).not.toHaveBeenCalled();
  });
});
