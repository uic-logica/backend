export type Mode = "INSTANT" | "SUMMARY" | "OFF";

/**
 * What a notification is about, for the email settings. "decisions" (an
 * application or talk decided, an interview request, a blog review) always
 * emails: nobody should miss one by having switched something off.
 */
export type Category = "events" | "messages" | "announcements" | "guestReplies" | "memberMessages" | "boardUpdates" | "decisions";

type Who = { role?: string | null; accountKind?: string | null };
// Same rule as isExecAccount in lib/authz.ts, for the looser shape a user row has here.
const isExec = (u: Who) => u.accountKind === "MEMBER" && u.role === "EXEC_BOARD";

/** The categories a person can set, in the order Settings shows them. */
export const CATEGORIES: { key: Exclude<Category, "decisions">; label: string; description: string; for: "member" | "nonExec" | "exec" }[] = [
  { key: "messages", label: "Messages from the board", description: "When the board writes in your thread.", for: "nonExec" },
  { key: "events", label: "Events", description: "Reminders, RSVP confirmations, posts and materials for events you're going to.", for: "member" },
  { key: "announcements", label: "Announcements", description: "News and updates from the LOGICA board.", for: "member" },
  { key: "guestReplies", label: "Guest replies", description: "A speaker or guest wrote in their thread.", for: "exec" },
  { key: "memberMessages", label: "Member messages", description: "A member or applicant wrote to the board.", for: "exec" },
  { key: "boardUpdates", label: "Applicant and blog updates", description: "Interview times shared, blog posts sent for review.", for: "exec" },
];

export function categoriesFor(user: Who) {
  const exec = isExec(user);
  const guest = user.accountKind === "SPEAKER";
  return CATEGORIES.filter((c) => (c.for === "nonExec" && !exec) || (c.for === "member" && !guest) || (c.for === "exec" && exec));
}

/** The choices a person has: the daily summary is for the exec board only. */
export const modesFor = (user: Who): Mode[] => (isExec(user) ? ["INSTANT", "SUMMARY", "OFF"] : ["INSTANT", "OFF"]);

/** Exec defaults: conversations right away, the rest in the 9 AM summary. Everyone else: right away. */
function defaultMode(category: Category, exec: boolean): Mode {
  if (!exec) return "INSTANT";
  return category === "guestReplies" || category === "memberMessages" || category === "messages" ? "INSTANT" : "SUMMARY";
}

/** How this person gets emails of this category, given what they saved. */
export function modeFor(user: Who, saved: unknown, category: Category): Mode {
  if (category === "decisions") return "INSTANT";
  const exec = isExec(user);
  const chosen = (saved && typeof saved === "object" ? (saved as Record<string, unknown>)[category] : undefined) as Mode | undefined;
  const mode = chosen === "INSTANT" || chosen === "SUMMARY" || chosen === "OFF" ? chosen : defaultMode(category, exec);
  // A summary choice left over from when they were on the exec board just sends.
  return mode === "SUMMARY" && !exec ? "INSTANT" : mode;
}
