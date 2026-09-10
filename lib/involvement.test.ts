import { describe, expect, it } from "vitest";

import { INVOLVEMENT_COUNTS, withInvolvement } from "./involvement";

describe("withInvolvement", () => {
  it("tests if the profile page breaks when field names get renamed", () => {
    // The raw names come from the database, but the profile page expects
    // different names. This makes sure they match.
    const profile = withInvolvement({
      id: "u1",
      name: "Ada",
      _count: { attendances: 3, posts: 7, submissions: 1 },
    });

    expect(profile).toEqual({
      id: "u1",
      name: "Ada",
      involvement: { eventsAttended: 3, postsMade: 7, formsSubmitted: 1 },
    });
  });

  it("tests if the profile page breaks when it gets duplicate data", () => {
    // If we send both the raw names and the renamed names, the response is
    // bigger than it needs to be and the page might render the same numbers twice.
    const profile = withInvolvement({ id: "u1", _count: { attendances: 0, posts: 0, submissions: 0 } });
    expect(profile).not.toHaveProperty("_count");
  });

  it("tests if the profile page breaks when no one has done anything yet", () => {
    // Early on, before events and posts are added to the system, these counts
    // are zero. The page should show zero, not undefined or missing fields.
    const { involvement } = withInvolvement({ _count: { attendances: 0, posts: 0, submissions: 0 } });
    expect(involvement).toEqual({ eventsAttended: 0, postsMade: 0, formsSubmitted: 0 });
  });
});

describe("INVOLVEMENT_COUNTS", () => {
  it("tests if the profile page breaks when we ask the database for the wrong counts", () => {
    // We need exactly three counts: events, posts, and forms. 
    expect(Object.keys(INVOLVEMENT_COUNTS.select).sort()).toEqual([
      "attendances",
      "posts",
      "submissions",
    ]);
  });
});