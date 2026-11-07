import { describe, expect, it } from "vitest";
import { EventInputError, eventLink, parseEventUpdate } from "./event-update";

describe("parseEventUpdate", () => {
  it("changes only the fields that were sent", () => {
    expect(parseEventUpdate({ description: "New line\nRoom 1413" })).toEqual({ description: "New line\nRoom 1413" });
  });

  it("takes only our own uploaded pictures, and clears with an empty string", () => {
    expect(parseEventUpdate({ image: "/api/blog/images/cmabc123" }).image).toBe("/api/blog/images/cmabc123");
    expect(parseEventUpdate({ image: "" }).image).toBeNull();
    expect(() => parseEventUpdate({ image: "https://evil.example/x.png" })).toThrow(EventInputError);
  });

  it("trims the title and parses the start time", () => {
    const data = parseEventUpdate({ title: "  Hack night ", startsAt: "2026-11-12T01:00:00.000Z" });
    expect(data.title).toBe("Hack night");
    expect(data.startsAt).toEqual(new Date("2026-11-12T01:00:00.000Z"));
  });

  it("takes an end time after the start, and drops it when the date goes TBD", () => {
    const data = parseEventUpdate({ startsAt: "2026-11-23T23:00:00.000Z", endsAt: "2026-11-24T00:30:00.000Z" });
    expect(data.endsAt).toEqual(new Date("2026-11-24T00:30:00.000Z"));
    expect(() => parseEventUpdate({ startsAt: "2026-11-23T23:00:00.000Z", endsAt: "2026-11-23T22:00:00.000Z" })).toThrow(EventInputError);
    expect(parseEventUpdate({ startsAt: "TBD", endsAt: "2026-11-24T00:30:00.000Z" }).endsAt).toBeNull();
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
