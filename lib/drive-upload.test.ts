import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDriveCache, uploadReceipt } from "./drive";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

beforeEach(() => {
  clearDriveCache();
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "bot@logica.iam.gserviceaccount.com");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  vi.stubEnv("GOOGLE_DRIVE_ROOT_FOLDER_ID", "root1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("uploadReceipt", () => {
  it("makes Receipts/<month> on first use, then uploads into it and returns the link", async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? "GET", body: init?.body });
        if (url.includes("oauth2")) return Response.json({ access_token: "tok", expires_in: 3600 });
        if (url.includes("/upload/")) return Response.json({ id: "file9", webViewLink: "https://drive.google.com/file/d/file9/view" });
        if (init?.method === "POST") return Response.json({ id: calls.length === 3 ? "receipts" : "month" });
        return Response.json({ files: [] }); // nothing there yet
      }),
    );
    const saved = await uploadReceipt({ name: "r.jpg", mimeType: "image/jpeg", bytes: Buffer.from("jpg") });
    expect(saved).toEqual({ id: "file9", url: "https://drive.google.com/file/d/file9/view" });
    const creates = calls.filter((c) => c.method === "POST" && !c.url.includes("oauth2") && !c.url.includes("/upload/"));
    expect(creates.map((c) => JSON.parse(String(c.body)).name)).toEqual(["Receipts", new Date().toISOString().slice(0, 7)]);
    const upload = calls.find((c) => c.url.includes("/upload/"))!;
    expect(upload.url).toContain("supportsAllDrives=true");
    expect(String(upload.body)).toContain('"parents":["month"]');
  });
});
