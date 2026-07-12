import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tabs.js", () => ({
  getTabIfExists: vi.fn()
}));
vi.mock("./status.js", () => ({
  syncSessionStatus: vi.fn()
}));

let extensionState: typeof import("./bridge-state.js").extensionState;
let attachDebugger: typeof import("./debugger.js").attachDebugger;
let ensureControlledTab: typeof import("./debugger.js").ensureControlledTab;
let runDebuggerCommand: typeof import("./debugger.js").runDebuggerCommand;
let withTimeout: typeof import("./debugger.js").withTimeout;
let getTabIfExists: ReturnType<typeof vi.fn>;

const debuggerAttach = vi.fn();
const debuggerDetach = vi.fn();
const debuggerGetTargets = vi.fn();
const debuggerSendCommand = vi.fn();

function clearExtensionState() {
  extensionState.sessions.clear();
  extensionState.activeSessionId = undefined;
  extensionState.attachedTabs.clear();
  extensionState.lastDetachReasons.clear();
  for (const entry of extensionState.registry.values()) {
    extensionState.registry.delete(entry.tabId);
  }
}

describe("debugger lifecycle", () => {
  beforeAll(async () => {
    vi.stubGlobal("chrome", {
      action: {
        setBadgeBackgroundColor: vi.fn(),
        setBadgeText: vi.fn()
      },
      debugger: {
        attach: debuggerAttach,
        detach: debuggerDetach,
        getTargets: debuggerGetTargets,
        onDetach: { addListener: vi.fn() },
        sendCommand: debuggerSendCommand
      }
    });
    ({ extensionState } = await import("./bridge-state.js"));
    ({ attachDebugger, ensureControlledTab, runDebuggerCommand, withTimeout } =
      await import("./debugger.js"));
    ({ getTabIfExists } = await import("./tabs.js") as unknown as {
      getTabIfExists: ReturnType<typeof vi.fn>;
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    clearExtensionState();
    debuggerAttach.mockResolvedValue(undefined);
    debuggerDetach.mockResolvedValue(undefined);
    debuggerGetTargets.mockResolvedValue([]);
    debuggerSendCommand.mockResolvedValue({});
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

  it("uses attachedTabs as the warm attach path without target introspection", async () => {
    extensionState.attachedTabs.add(51);

    await attachDebugger(51);

    expect(debuggerGetTargets).not.toHaveBeenCalled();
    expect(getTabIfExists).not.toHaveBeenCalled();
    expect(debuggerAttach).not.toHaveBeenCalled();
    expect(debuggerSendCommand).not.toHaveBeenCalled();
  });

  it("ensures an already-attached controlled tab with one live-tab lookup", async () => {
    const tab = {
      active: false,
      id: 52,
      title: "Example",
      url: "https://example.test/",
      windowId: 1
    } as chrome.tabs.Tab;
    extensionState.sessions.set("session-a", {
      clientId: "a",
      sessionId: "session-a",
      tabIds: new Set([52])
    });
    extensionState.attachedTabs.add(52);
    getTabIfExists.mockResolvedValue(tab);

    await expect(ensureControlledTab("session-a", 52)).resolves.toBe(tab);

    expect(getTabIfExists).toHaveBeenCalledTimes(1);
    expect(debuggerGetTargets).not.toHaveBeenCalled();
    expect(debuggerAttach).not.toHaveBeenCalled();
  });

  it("reconciles attached tabs after a debugger command error", async () => {
    extensionState.attachedTabs.add(53);
    debuggerSendCommand.mockRejectedValueOnce(new Error("detached"));
    debuggerGetTargets.mockResolvedValueOnce([]);

    await expect(
      runDebuggerCommand(53, "Runtime.evaluate", {}, "evaluate")
    ).rejects.toThrow("detached");

    expect(debuggerGetTargets).toHaveBeenCalledTimes(1);
    expect(extensionState.attachedTabs.has(53)).toBe(false);
  });
});
