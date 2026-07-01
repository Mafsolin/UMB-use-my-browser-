import { describe, expect, it } from "vitest";
import { createCommandRouter } from "./command-router.js";

describe("command router", () => {
  it("routes newTab to the browser transport", async () => {
    let called = false;
    const router = createCommandRouter({
      newTab: async () => {
        called = true;
        return { id: "1" };
      }
    } as never);

    await router({
      type: "newTab",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      params: {}
    });

    expect(called).toBe(true);
  });
});
