import { expect, it } from "vitest";
import { GET } from "./route";

it("does not allow the development role switcher to bypass password login", async () => {
  const response = await GET();
  expect(response.status).toBe(404);
  expect(response.headers.get("set-cookie")).toBeNull();
});
