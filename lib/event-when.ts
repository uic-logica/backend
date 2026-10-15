const chicago = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "Thursday, October 22 at 5:00 PM" in Chicago time, or "Date TBD". */
export function whenDate(startsAt: Date | null): string {
  return startsAt ? chicago.format(startsAt) : "Date TBD";
}

/** "Thursday, October 22 at 5:00 PM in CDRLC 1413", for one-line notifications. */
export function when(event: { startsAt: Date | null; location?: string | null }): string {
  const date = event.startsAt ? chicago.format(event.startsAt) : "date TBD";
  return event.location ? `${date} in ${event.location}` : date;
}

/** The When / Where rows of an email's details box. */
export function eventDetails(event: { startsAt: Date | null; location?: string | null }): [string, string][] {
  return [["When", whenDate(event.startsAt)], ...(event.location ? ([["Where", event.location]] as [string, string][]) : [])];
}
