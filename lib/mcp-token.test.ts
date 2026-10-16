import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { callerFor, hashToken } from "./mcp-token";

vi.mock("@/lib/prisma", () => ({
  prisma: { mcpToken: { findUnique: vi.fn(), update: vi.fn(() => Promise.resolve()) } },
}));

describe("callerFor", () => {
  it("refuses a partner club's token: partners have no agent surface", async () => {
    const secret = "logica_partner";
    vi.mocked(prisma.mcpToken.findUnique).mockResolvedValue({
      id: "t1",
      revokedAt: null,
      tokenHash: hashToken(secret),
      user: { id: "p1", accountKind: "PARTNER", role: "MEMBER", speakerSubmission: null },
    } as never);
    expect(await callerFor(`Bearer ${secret}`)).toBeNull();
  });
});
