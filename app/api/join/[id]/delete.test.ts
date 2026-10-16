import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DELETE } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { membershipApplication: { deleteMany: vi.fn() } } }));

const as = (role: string, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role, accountKind }, expires: "" } as never);
const del = () => DELETE(new NextRequest("http://localhost/api/join/a1", { method: "DELETE" }), { params: Promise.resolve({ id: "a1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.membershipApplication.deleteMany).mockResolvedValue({ count: 1 });
});

describe("DELETE /api/join/:id", () => {
  it("lets an exec delete an application", async () => {
    as("EXEC_BOARD");
    expect((await del()).status).toBe(204);
    expect(prisma.membershipApplication.deleteMany).toHaveBeenCalledWith({ where: { id: "a1" } });
  });

  it("refuses board, members and speaker accounts; 404s an unknown id", async () => {
    for (const [role, kind] of [["BOARD", "MEMBER"], ["MEMBER", "MEMBER"], ["EXEC_BOARD", "SPEAKER"]]) {
      as(role, kind);
      expect((await del()).status).toBe(403);
    }
    expect(prisma.membershipApplication.deleteMany).not.toHaveBeenCalled();
    as("EXEC_BOARD");
    vi.mocked(prisma.membershipApplication.deleteMany).mockResolvedValue({ count: 0 });
    expect((await del()).status).toBe(404);
  });
});
