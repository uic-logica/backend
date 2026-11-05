import { after } from "next/server";

/**
 * Side work a save shouldn't wait on (emails, notifications): runs after the
 * response is sent, so the dashboard gets its answer at once. A failure is
 * logged, never turned into a failed save.
 *
 * Outside a request (tests, scripts) `after` throws, so the work just runs
 * and is awaited — tests still see the notice go out.
 */
export async function later(task: () => Promise<unknown>): Promise<void> {
  const safe = async () => {
    try {
      await task();
    } catch (error) {
      console.error("after-response task failed", error);
    }
  };
  try {
    after(safe);
  } catch {
    await safe();
  }
}
