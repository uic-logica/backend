import { describe, expect, it } from "vitest";
import {
  hashInvite,
  isVisitKind,
  mintInvite,
  normalizeEmail,
  passwordProblem,
  VISIT_NOUN,
} from "./invite";

describe("mintInvite", () => {
  it("returns a secret and only ever stores its hash", () => {
    const invite = mintInvite();
    expect(invite.secret).toMatch(/^inv_/);
    expect(invite.inviteTokenHash).toBe(hashInvite(invite.secret));
    // The thing written to the database must not contain the secret.
    expect(invite.inviteTokenHash).not.toContain(invite.secret.slice(4));
  });

  it("is long enough not to be guessed", () => {
    // 32 bytes of CSPRNG, base64url — this link creates an account.
    expect(mintInvite().secret.length).toBeGreaterThan(40);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintInvite().secret));
    expect(seen.size).toBe(200);
  });

  it("expires, and not in the distant future", () => {
    const { inviteExpiresAt } = mintInvite();
    const days = (inviteExpiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThan(15);
  });

  it("starts unused", () => {
    expect(mintInvite().inviteUsedAt).toBeNull();
  });
});

describe("passwordProblem", () => {
  it("accepts a passphrase", () => {
    expect(passwordProblem("correct horse battery")).toBeNull();
  });

  it("rejects short, empty and missing", () => {
    expect(passwordProblem("short")).toMatch(/10 characters/);
    expect(passwordProblem("")).toMatch(/Choose a password/);
    expect(passwordProblem(undefined)).toMatch(/Choose a password/);
    expect(passwordProblem(12345678901)).toMatch(/Choose a password/);
  });

  it("rejects one long enough to be a denial of service against scrypt", () => {
    expect(passwordProblem("x".repeat(500))).toMatch(/too long/);
  });

  /** No character-class rules on purpose — see the comment in invite.ts. */
  it("does not demand punctuation or digits", () => {
    expect(passwordProblem("allloweralpha")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("rejects anything that isn't an address", () => {
    for (const bad of ["", "nope", "no@tld", "@nolocal.com", "two@@at.com", null, 5]) {
      expect(normalizeEmail(bad), String(bad)).toBeNull();
    }
  });

  /** Guests are not UIC students — no domain restriction here, unlike members. */
  it("accepts any domain", () => {
    expect(normalizeEmail("someone@zebra.example")).toBe("someone@zebra.example");
  });
});

describe("visit kinds", () => {
  it("recognises exactly the three", () => {
    expect(isVisitKind("TALK")).toBe(true);
    expect(isVisitKind("WORKSHOP")).toBe(true);
    expect(isVisitKind("COMPANY_VISIT")).toBe(true);
    expect(isVisitKind("talk")).toBe(false);
    expect(isVisitKind("PANEL")).toBe(false);
    expect(isVisitKind(undefined)).toBe(false);
  });

  it("has a word for each one", () => {
    expect(Object.keys(VISIT_NOUN).sort()).toEqual(["COMPANY_VISIT", "TALK", "WORKSHOP"]);
  });
});
