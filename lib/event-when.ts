/** "Thursday, October 22, 5:00 PM in CDRLC 1413" in Chicago time, or "date TBD". For emails. */
export function when(event: { startsAt: Date | null; location?: string | null }): string {
  const date = event.startsAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(event.startsAt)
    : "date TBD";
  return event.location ? `${date} in ${event.location}` : date;
}
