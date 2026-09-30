import { describe, expect, it } from "vitest";
import { attachmentContentDisposition } from "./content-disposition";

describe("attachmentContentDisposition", () => {
  it("removes quotes, backslashes, and CRLF from the ASCII fallback", () => {
    expect(attachmentContentDisposition('bad"\\name\r\nX-Evil: yes.pdf')).toBe(
      "attachment; filename=\"badnameX-Evil: yes.pdf\"; filename*=UTF-8''badnameX-Evil%3A%20yes.pdf",
    );
  });

  it("provides an ASCII fallback and RFC 5987 encoding for Unicode", () => {
    expect(attachmentContentDisposition("résumé 你好.pdf")).toBe(
      "attachment; filename=\"r_sum_ __.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%E4%BD%A0%E5%A5%BD.pdf",
    );
  });

  it("falls back to download", () => {
    expect(attachmentContentDisposition("\r\n")).toBe("attachment; filename=\"download\"; filename*=UTF-8''download");
  });
});
