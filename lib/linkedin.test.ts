import { describe, expect, it } from "vitest";
import { normalizeLinkedin } from "./linkedin";

describe("normalizeLinkedin", () => {
  it("stores bare, www and http links as full https URLs", () => {
    expect(normalizeLinkedin("linkedin.com/in/ana")).toEqual({ ok: true, url: "https://linkedin.com/in/ana" });
    expect(normalizeLinkedin(" https://www.linkedin.com/in/ana/ ")).toEqual({ ok: true, url: "https://www.linkedin.com/in/ana" });
    expect(normalizeLinkedin("http://linkedin.com/in/ana#about")).toEqual({ ok: true, url: "https://linkedin.com/in/ana" });
  });
  it("clears on empty", () => {
    expect(normalizeLinkedin("   ")).toEqual({ ok: true, url: null });
  });
  it("rejects other sites and look-alikes", () => {
    expect(normalizeLinkedin("https://github.com/ana").ok).toBe(false);
    expect(normalizeLinkedin("https://linkedin.com.evil.io/in/ana").ok).toBe(false);
    expect(normalizeLinkedin("https://notlinkedin.com/in/ana").ok).toBe(false);
  });
  it("rejects the bare homepage", () => {
    expect(normalizeLinkedin("linkedin.com").ok).toBe(false);
  });
});
