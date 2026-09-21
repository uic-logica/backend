import { expect, it } from "vitest";
import { POST } from "./route";

it("refuses old passwordless code redemption without issuing a cookie", async () => {
  const response = await POST();
  expect(response.status).toBe(410);
  expect(response.headers.get("set-cookie")).toBeNull();
});
