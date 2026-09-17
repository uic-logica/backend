/**
 * Fixed-window attempt counter.
 *
 * logica-lean: the counter lives in one server process's memory — it resets on
 * redeploy, and a multi-instance deploy multiplies the effective ceiling by the
 * number of instances. Revisit when we run more than one instance. Sign-in
 * codes don't use this; they're limited in Postgres (lib/sign-in-limit.ts).
 */
const windows = new Map<string, { count: number; resetAt: number }>();

/**
 * Records an attempt against `key`. Returns `true` when the caller is over
 * `limit` for the current window and should be refused.
 */
export function overAttemptLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    sweep(now);
    return false;
  }

  existing.count += 1;
  return existing.count > limit;
}

/** Clears the counter for `key` — call after a success so a typo isn't held against the user. */
export function clearAttempts(key: string): void {
  windows.delete(key);
}

/** Drops expired windows so the map can't grow without bound. */
function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}
