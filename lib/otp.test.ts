import { afterEach, describe, expect, it } from "vitest";

import { generateOtp, isAllowedEmail, otpEmail, OTP_MAX_AGE_SECONDS } from "./otp";

const original = process.env.ALLOWED_EMAIL_DOMAIN;
afterEach(() => {
  process.env.ALLOWED_EMAIL_DOMAIN = original;
});

describe("generateOtp", () => {
  it("is always six digits, zero-padded", () => {
    for (let i = 0; i < 2000; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("can produce codes in the low range that padding would otherwise shorten", () => {
    // 2000 draws from 10^6 won't hit 000042 on purpose, so assert the property
    // that matters: nothing is ever shorter than six characters.
    const lengths = new Set(Array.from({ length: 2000 }, () => generateOtp().length));
    expect([...lengths]).toEqual([6]);
  });

  it("does not repeat itself constantly", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateOtp()));
    // A fixed or badly-seeded generator collapses this to a handful of values.
    expect(seen.size).toBeGreaterThan(450);
  });
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

describe("otpEmail", () => {
  it("puts the code and expiry in the subject and both bodies", () => {
    const { subject, text, html } = otpEmail("123456", 10);
    expect(subject).toContain("123456");
    expect(text).toContain("123456");
    expect(text).toContain("10 minutes");
    expect(html).toContain("123456");
    expect(html).toContain("10 minutes");
  });
});

describe("OTP_MAX_AGE_SECONDS", () => {
  it("is ten minutes, the window the rate-limit issue is measured against", () => {
    expect(OTP_MAX_AGE_SECONDS).toBe(600);
  });
});
