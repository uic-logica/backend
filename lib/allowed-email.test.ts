import { afterEach, describe, expect, it } from "vitest";

import { isAllowedEmail } from "./allowed-email";

const original = process.env.ALLOWED_EMAIL_DOMAIN;
afterEach(() => {
  process.env.ALLOWED_EMAIL_DOMAIN = original;
});

describe("isAllowedEmail", () => {
  it("fails closed when the domain is unset or empty", () => {
    delete process.env.ALLOWED_EMAIL_DOMAIN;
    expect(isAllowedEmail("someone@uic.edu")).toBe(false);

    process.env.ALLOWED_EMAIL_DOMAIN = "";
    expect(isAllowedEmail("someone@uic.edu")).toBe(false);

    process.env.ALLOWED_EMAIL_DOMAIN = "   ";
    expect(isAllowedEmail("someone@uic.edu")).toBe(false);
  });

  it("accepts an address on the configured domain", () => {
    process.env.ALLOWED_EMAIL_DOMAIN = "uic.edu";
    expect(isAllowedEmail("someone@uic.edu")).toBe(true);
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    process.env.ALLOWED_EMAIL_DOMAIN = "  UIC.edu  ";
    expect(isAllowedEmail("  SomeOne@UIC.EDU  ")).toBe(true);
  });

  it("rejects a missing address", () => {
    process.env.ALLOWED_EMAIL_DOMAIN = "uic.edu";
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail(undefined)).toBe(false);
    expect(isAllowedEmail("")).toBe(false);
    expect(isAllowedEmail("   ")).toBe(false);
  });

  it("rejects lookalike domains that merely end in the right letters", () => {
    process.env.ALLOWED_EMAIL_DOMAIN = "uic.edu";
    // The @ in the comparison is what stops these; without it, all three pass.
    expect(isAllowedEmail("attacker@evil-uic.edu")).toBe(false);
    expect(isAllowedEmail("attacker@notuic.edu")).toBe(false);
    expect(isAllowedEmail("attacker@sub.uic.edu")).toBe(false);
  });

  it("rejects the domain appearing anywhere but the end", () => {
    process.env.ALLOWED_EMAIL_DOMAIN = "uic.edu";
    expect(isAllowedEmail("someone@uic.edu.attacker.com")).toBe(false);
    expect(isAllowedEmail("uic.edu@gmail.com")).toBe(false);
  });

  it("rejects an address with no domain at all", () => {
    process.env.ALLOWED_EMAIL_DOMAIN = "uic.edu";
    expect(isAllowedEmail("uic.edu")).toBe(false);
  });
});
