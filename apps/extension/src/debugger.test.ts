import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let withTimeout: typeof import("./debugger.js").withTimeout;

describe("withTimeout", () => {
  beforeAll(async () => {
    vi.stubGlobal("chrome", {
      action: {
        setBadgeBackgroundColor: vi.fn(),
        setBadgeText: vi.fn()
      },
      debugger: {
        onDetach: { addListener: vi.fn() }
      }
    });
    ({ withTimeout } = await import("./debugger.js"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("clears its timeout after the operation settles", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await expect(withTimeout(Promise.resolve("done"), "Debugger test", 100)).resolves.toBe(
      "done"
    );

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
