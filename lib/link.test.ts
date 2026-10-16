import { describe, expect, it } from "vitest";
import { parseHttpLink } from "./link";

describe("parseHttpLink", () => {
  it("accepts http and https, and normalizes", () => {
    expect(parseHttpLink("https://logicauic.org/events")).toEqual({
      ok: true,
      url: "https://logicauic.org/events",
    });
    expect(parseHttpLink("  http://example.com  ")).toEqual({ ok: true, url: "http://example.com/" });
  });

  it("rejects schemes that aren't http(s)", () => {
    for (const raw of ["javascript:alert(1)", "data:text/html,<script>", "mailto:x@uic.edu", "file:///etc/passwd"]) {
      expect(parseHttpLink(raw)).toEqual({ ok: false, reason: "scheme" });
    }
  });

  it("rejects anything that isn't a URL", () => {
    for (const raw of ["", "   ", "logicauic.org", "not a url"]) {
      expect(parseHttpLink(raw)).toEqual({ ok: false, reason: "invalid" });
    }
  });
});
