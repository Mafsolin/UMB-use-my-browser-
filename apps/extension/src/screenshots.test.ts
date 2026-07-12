import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { ensureControlledTab, runDebuggerCommand } = vi.hoisted(() => ({
  ensureControlledTab: vi.fn(),
  runDebuggerCommand: vi.fn()
}));

vi.mock("./debugger.js", () => ({ ensureControlledTab, runDebuggerCommand }));

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
