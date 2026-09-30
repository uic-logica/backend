import { describe, it, expect } from "vitest";
import { parseUpload } from "./upload";

const file = (filename: string, mimeType: string, bytes: number[] | string) => ({
  filename,
  mimeType,
  data: Buffer.from(bytes).toString("base64"),
});
const VALID = file("resume.pdf", "application/pdf", "%PDF-1.7\nhello");

describe("parseUpload", () => {
  it("accepts a valid upload", () => {
    const result = parseUpload(VALID, 1024, ["pdf"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.upload.filename).toBe("resume.pdf");
      expect(result.upload.mimeType).toBe("application/pdf");
      expect(Buffer.from(result.upload.data).toString()).toBe("%PDF-1.7\nhello");
    }
  });

  it("rejects a missing filename", () => {
    expect(parseUpload({ ...VALID, filename: "" }, 1024, ["pdf"]).ok).toBe(false);
  });

  it("rejects a missing mimeType", () => {
    expect(parseUpload({ ...VALID, mimeType: undefined }, 1024, ["pdf"]).ok).toBe(false);
  });

  it("rejects missing data", () => {
    expect(parseUpload({ ...VALID, data: "" }, 1024, ["pdf"]).ok).toBe(false);
  });

  it("rejects a file over the size cap", () => {
    const big = { ...VALID, data: Buffer.alloc(2000).toString("base64") };
    expect(parseUpload(big, 1024, ["pdf"]).ok).toBe(false);
  });

  it.each([
    [file("resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", [0x50, 0x4b, 0x03, 0x04]), "docx"],
    [file("resume.doc", "application/msword", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "doc"],
    [file("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", [0x50, 0x4b, 0x03, 0x04]), "pptx"],
    [file("slides.ppt", "application/vnd.ms-powerpoint", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "ppt"],
    [file("image.png", "image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "png"],
    [file("image.jpg", "image/jpeg", [0xff, 0xd8, 0xff, 0xe0]), "jpeg"],
  ] as const)("accepts a %s upload with matching signature", (upload, kind) => {
    expect(parseUpload(upload, 1024, [kind]).ok).toBe(true);
  });

  it("rejects HTML bytes spoofing a PDF MIME type", () => {
    expect(parseUpload(file("resume.pdf", "application/pdf", "<html>not a pdf</html>"), 1024, ["pdf"]).ok).toBe(false);
  });

  it("rejects a valid file kind when it is not allowed for that use", () => {
    expect(parseUpload(file("image.png", "image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 1024, ["pdf"]).ok).toBe(false);
  });

  it("rejects control characters in filenames", () => {
    expect(parseUpload({ ...VALID, filename: "resume\r\nX-Evil: yes.pdf" }, 1024, ["pdf"]).ok).toBe(false);
  });
});

describe("parseUpload trusts contents over the browser's MIME claim", () => {
  it("accepts a real .docx reported as application/octet-stream", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).toString("base64");
    const result = parseUpload({ filename: "resume.docx", mimeType: "application/octet-stream", data: zip }, 1024, ["pdf", "docx", "doc"]);
    expect(result).toMatchObject({ ok: true, upload: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } });
  });
});
