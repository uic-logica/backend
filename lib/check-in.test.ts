import { describe, it, expect } from "vitest";
import { checkCode, generateCheckInCode, normalizeCheckInCode } from "./check-in";

describe("generateCheckInCode", () => {
  it("makes 6-character codes without look-alike characters", () => {
    for (let i = 0; i < 1000; i++) {
      expect(generateCheckInCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    }
  });
});

describe("normalizeCheckInCode", () => {
  it("ignores case, spaces and dashes", () => {
    expect(normalizeCheckInCode(" abc-23 4 ")).toBe("ABC234");
  });
});

describe("checkCode", () => {
  const now = new Date("2026-10-01T18:00:00Z");
  const open = { code: "ABC234", expiresAt: new Date("2026-10-01T19:00:00Z") };

  it("accepts the open code, however it was typed", () => {
    expect(checkCode(open, "abc-234", now)).toBe("ok");
  });

  it("rejects a wrong code", () => {
    expect(checkCode(open, "ABC235", now)).toBe("wrong");
  });

  it("rejects the right code once it has expired", () => {
    expect(checkCode(open, "ABC234", open.expiresAt)).toBe("expired");
  });

  it("rejects everything when check-in was never opened", () => {
    expect(checkCode(null, "ABC234", now)).toBe("closed");
  });
});
