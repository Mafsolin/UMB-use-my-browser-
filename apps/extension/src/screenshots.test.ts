import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { ensureControlledTab, runDebuggerCommand } = vi.hoisted(() => ({
  ensureControlledTab: vi.fn(),
  runDebuggerCommand: vi.fn()
}));

vi.mock("./debugger.js", () => ({ ensureControlledTab, runDebuggerCommand }));

import {
  DEBUGGER_STAGE_TIMEOUT_MS,
  SCREENSHOT_CAPTURE_TIMEOUT_MS
} from "./bridge-state.js";
import { screenshot } from "./screenshots.js";

describe("screenshot masking", () => {
  beforeAll(() => {
    Object.assign(globalThis, { chrome: {} });
  });

  beforeEach(() => {
    ensureControlledTab.mockReset().mockResolvedValue(undefined);
    runDebuggerCommand.mockReset()
      .mockResolvedValueOnce({ result: { value: true } })
      .mockResolvedValueOnce({ data: "image" })
      .mockResolvedValueOnce({ result: { value: true } });
  });

  it("uses a dedicated capture timeout without changing masking evaluations", async () => {
    await expect(screenshot("session", 7)).resolves.toBe("data:image/png;base64,image");

    expect(SCREENSHOT_CAPTURE_TIMEOUT_MS).toBe(15_000);
    expect(DEBUGGER_STAGE_TIMEOUT_MS).toBe(5_000);
    expect(runDebuggerCommand.mock.calls[0]).toHaveLength(4);
    expect(runDebuggerCommand.mock.calls[1]).toEqual([
      7,
      "Page.captureScreenshot",
      { format: "png" },
      "screenshot",
      SCREENSHOT_CAPTURE_TIMEOUT_MS
    ]);
    expect(runDebuggerCommand.mock.calls[2]).toHaveLength(4);
  });

  it("removes masking after capture times out", async () => {
    runDebuggerCommand.mockReset()
      .mockResolvedValueOnce({ result: { value: true } })
      .mockRejectedValueOnce(new Error("Debugger screenshot timed out after 15000ms."))
      .mockResolvedValueOnce({ result: { value: true } });

    await expect(screenshot("session", 7)).rejects.toThrow("timed out after 15000ms");

    expect(runDebuggerCommand).toHaveBeenCalledTimes(3);
    expect(runDebuggerCommand.mock.calls[1][4]).toBe(SCREENSHOT_CAPTURE_TIMEOUT_MS);
    expect(runDebuggerCommand.mock.calls[2][1]).toBe("Runtime.evaluate");
    expect(runDebuggerCommand.mock.calls[2][2].expression).toContain("data-umb-redaction-style");
  });

  it("only removes masking styles marked as owned by UMB", async () => {
    await expect(screenshot("session", 7)).resolves.toBe("data:image/png;base64,image");

    const applyExpression = runDebuggerCommand.mock.calls[0][2].expression as string;
    const removeExpression = runDebuggerCommand.mock.calls[2][2].expression as string;
    expect(applyExpression).toContain("data-umb-redaction-style");
    expect(removeExpression).toContain("data-umb-redaction-style");
    expect(applyExpression).not.toContain("getElementById");
    expect(removeExpression).not.toContain("getElementById");
  });
});
