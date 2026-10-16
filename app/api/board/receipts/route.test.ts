import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { driveConfigured, uploadReceipt } from "@/lib/drive";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/drive", () => ({ driveConfigured: vi.fn(() => true), uploadReceipt: vi.fn(async () => ({ id: "f1", url: "https://drive.google.com/file/d/f1/view" })) }));

const as = (role: string, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role, accountKind }, expires: "" } as never);
const send = (file?: File) => {
  const form = new FormData();
  if (file) form.set("file", file);
  return POST(new NextRequest("http://localhost/api/board/receipts", { method: "POST", body: form }));
};
const photo = (type = "image/jpeg", size = 1000) => new File([new Uint8Array(size)], "IMG_1234.jpg", { type });

beforeEach(() => {
  vi.clearAllMocks();
  as("EXEC_BOARD");
});

describe("POST /api/board/receipts", () => {
  it("saves the receipt to Drive with a dated name and returns the link", async () => {
    const res = await send(photo());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "f1", url: "https://drive.google.com/file/d/f1/view" });
    expect(uploadReceipt).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "image/jpeg", name: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}h\d{2} IMG_1234\.jpg$/) }));
  });

  it("refuses non-exec, missing or wrong files, big files, and an unconnected Drive", async () => {
    as("BOARD");
    expect((await send(photo())).status).toBe(403);
    as("EXEC_BOARD");
    expect((await send()).status).toBe(400);
    expect((await send(photo("text/html"))).status).toBe(400);
    expect((await send(photo("image/jpeg", 5 * 1024 * 1024))).status).toBe(413);
    vi.mocked(driveConfigured).mockReturnValueOnce(false);
    expect((await send(photo())).status).toBe(503);
    expect(uploadReceipt).not.toHaveBeenCalled();
  });
});
