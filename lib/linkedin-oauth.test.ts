import { describe, expect, it, vi } from "vitest";
import { createLinkedInState, linkedInRedirectUri, validateLinkedInImage, verifyLinkedInState } from "./linkedin-oauth";

describe("LinkedIn OAuth helpers", () => {
  it("accepts only the state paired with its signed cookie", () => {
    const secret = "test-secret";
    const { state, cookie } = createLinkedInState(secret);
    expect(verifyLinkedInState(state, cookie, secret)).toBe(true);
    expect(verifyLinkedInState(`${state}x`, cookie, secret)).toBe(false);
    expect(verifyLinkedInState(state, `${cookie}x`, secret)).toBe(false);
  });

  it("rejects non-images and oversized images", () => {
    expect(validateLinkedInImage("text/html", new ArrayBuffer(4)).ok).toBe(false);
    expect(validateLinkedInImage("image/svg+xml", new ArrayBuffer(4)).ok).toBe(false);
    expect(validateLinkedInImage("image/jpeg", new ArrayBuffer(5), 4).ok).toBe(false);
    expect(validateLinkedInImage("image/png; charset=binary", new ArrayBuffer(4), 4)).toMatchObject({
      ok: true,
      mimeType: "image/png",
    });
  });
});

describe("linkedInRedirectUri", () => {
  it("uses the first FRONTEND_URL origin", () => {
    vi.stubEnv("FRONTEND_URL", "https://logicauic.org, https://old.vercel.app");
    expect(linkedInRedirectUri()).toBe("https://logicauic.org/api/linkedin/callback");
    vi.unstubAllEnvs();
  });
});
