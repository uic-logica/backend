import { describe, it, expect } from "vitest";
import { parseUpload } from "./upload";

const VALID = { filename: "resume.pdf", mimeType: "application/pdf", data: Buffer.from("hello").toString("base64") };

describe("parseUpload", () => {
  it("accepts a valid upload", () => {
    const result = parseUpload(VALID, 1024);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.upload.filename).toBe("resume.pdf");
      expect(Buffer.from(result.upload.data).toString()).toBe("hello");
    }
  });

  it("rejects a missing filename", () => {
    expect(parseUpload({ ...VALID, filename: "" }, 1024).ok).toBe(false);
  });

  it("rejects a missing mimeType", () => {
    expect(parseUpload({ ...VALID, mimeType: undefined }, 1024).ok).toBe(false);
  });

  it("rejects missing data", () => {
    expect(parseUpload({ ...VALID, data: "" }, 1024).ok).toBe(false);
  });

  it("rejects a file over the size cap", () => {
    const big = { ...VALID, data: Buffer.alloc(2000).toString("base64") };
    expect(parseUpload(big, 1024).ok).toBe(false);
  });
});
