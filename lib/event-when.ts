const tz = "America/Chicago";
const chicago = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
const clock = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

type Times = { startsAt: Date | null; endsAt?: Date | null };

/** "Thursday, October 22 at 5:00 PM – 6:30 PM" in Chicago time, or "Date TBD". */
export function whenDate(startsAt: Date | null, endsAt?: Date | null): string {
  if (!startsAt) return "Date TBD";
  return endsAt ? `${chicago.format(startsAt)} – ${clock.format(endsAt)}` : chicago.format(startsAt);
}

/** "Thursday, October 22 at 5:00 PM – 6:30 PM in CDRLC 1413", for one-line notifications. */
export function when(event: Times & { location?: string | null }): string {
  const date = event.startsAt ? whenDate(event.startsAt, event.endsAt) : "date TBD";
  return event.location ? `${date} in ${event.location}` : date;
}

/** The When / Where rows of an email's details box. */
export function eventDetails(event: Times & { location?: string | null }): [string, string][] {
  return [["When", whenDate(event.startsAt, event.endsAt)], ...(event.location ? ([["Where", event.location]] as [string, string][]) : [])];
}
