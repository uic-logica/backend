import { describe, expect, it } from "vitest";
import { EventInputError, eventLink, parseEventUpdate } from "./event-update";

describe("parseEventUpdate", () => {
  it("changes only the fields that were sent", () => {
    expect(parseEventUpdate({ description: "New line\nRoom 1413" })).toEqual({ description: "New line\nRoom 1413" });
  });

  it("trims the title and parses the start time", () => {
    const data = parseEventUpdate({ title: "  Hack night ", startsAt: "2026-11-12T01:00:00.000Z" });
    expect(data.title).toBe("Hack night");
    expect(data.startsAt).toEqual(new Date("2026-11-12T01:00:00.000Z"));
  });

  it("clears location, description and link with an empty string", () => {
    expect(parseEventUpdate({ location: "", description: "", link: "" })).toEqual({ location: null, description: null, link: null });
  });

  it("refuses an empty title, a bad date, a non-http link and an empty edit", () => {
    expect(() => parseEventUpdate({ title: "  " })).toThrow(EventInputError);
    expect(() => parseEventUpdate({ startsAt: "tomorrow-ish" })).toThrow(EventInputError);
    expect(() => parseEventUpdate({ link: "javascript:alert(1)" })).toThrow("`link` must be an http or https URL.");
    expect(() => parseEventUpdate({})).toThrow("Send at least one field to change.");
  });
});

describe("eventLink", () => {
  it("keeps http(s) links and tells 'not sent' from 'clear'", () => {
    expect(eventLink("https://lu.ma/x")).toBe("https://lu.ma/x");
    expect(eventLink(undefined)).toBeUndefined();
    expect(eventLink("")).toBeNull();
  });
});
