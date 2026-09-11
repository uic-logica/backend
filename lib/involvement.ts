/**
 * The "involvement" block on a member profile looks at how many events they've
 * attended, posts they've written, and forms they've submitted. These are 
 * counted when the profile is read, not stored on the user. 
 * 
 * Counting an empty table returns zero right now because
 * we haven't implemented the necessary logic in the later parts.
 */
export const INVOLVEMENT_COUNTS = {
  select: { attendances: true, posts: true, submissions: true },
} as const;

/** What Prisma hands back for the counts for involvement. */
type InvolvementCounts = {
  attendances: number;
  posts: number;
  submissions: number;
};

/**
 * This function Swaps Prisma's _count for the involvement summary 
 * the profile page reads.
 */
export function withInvolvement<T extends { _count: InvolvementCounts }>(user: T) {
  const { _count, ...profile } = user;
  return {
    ...profile,
    involvement: {
      eventsAttended: _count.attendances,
      postsMade: _count.posts,
      formsSubmitted: _count.submissions,
    },
  };
}