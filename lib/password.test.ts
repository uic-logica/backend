import { describe, it, expect } from "vitest";
import { generateTempPassword, hashPassword, slugifyUsername, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects the wrong password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", () => {
    const a = hashPassword("same input");
    const b = hashPassword("same input");
    expect(a).not.toBe(b);
    expect(verifyPassword("same input", a)).toBe(true);
    expect(verifyPassword("same input", b)).toBe(true);
  });

  it("rejects a malformed stored value instead of throwing", () => {
    expect(verifyPassword("anything", "not-a-real-hash")).toBe(false);
  });
});

describe("generateTempPassword", () => {
  it("generates a reasonably long, non-empty value", () => {
    const pw = generateTempPassword();
    expect(pw.length).toBeGreaterThanOrEqual(10);
  });

  it("generates different values each call", () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});

describe("slugifyUsername", () => {
  it("slugifies a name", () => {
    expect(slugifyUsername("Ada Lovelace", "ada@example.com")).toBe("ada.lovelace");
  });

  it("falls back to the email local part when there's no name", () => {
    expect(slugifyUsername(null, "ada.lovelace@example.com")).toBe("ada.lovelace");
  });

  it("strips accents and punctuation", () => {
    expect(slugifyUsername("José Ñandú!!", "x@example.com")).toBe("jose.nandu");
  });

  it("never returns an empty string", () => {
    expect(slugifyUsername("!!!", "@example.com")).toBe("speaker");
  });
});
