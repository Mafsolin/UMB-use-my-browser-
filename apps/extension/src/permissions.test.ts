import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const debuggerMocks = vi.hoisted(() => ({
  detachDebuggerNow: vi.fn(),
  forceDetachDebugger: vi.fn(),
  refreshAttachedTabsFromBrowser: vi.fn()
}));
const getTabIfExists = vi.hoisted(() => vi.fn());

vi.mock("./debugger.js", () => debuggerMocks);
vi.mock("./tabs.js", () => ({
  getTabIfExists,
  removeTabFromSessions: vi.fn(),
  tabIdFromString: (value: string) => Number(value)
}));
vi.mock("./status.js", () => ({
  syncSessionStatus: vi.fn(),
  updateStatus: vi.fn()
}));

let extensionState: typeof import("./bridge-state.js").extensionState;
let finalize: typeof import("./permissions.js").finalize;

function clearExtensionState() {
  extensionState.sessions.clear();
  extensionState.activeSessionId = undefined;
  extensionState.attachedTabs.clear();
  extensionState.lastDetachReasons.clear();
  for (const entry of extensionState.registry.values()) {
    extensionState.registry.delete(entry.tabId);
  }
}

describe("finalize", () => {
  beforeAll(async () => {
    vi.stubGlobal("chrome", {
      action: {
        setBadgeBackgroundColor: vi.fn(),
        setBadgeText: vi.fn()
      },
      tabs: {
        onRemoved: { addListener: vi.fn() },
        remove: vi.fn()
      }
    });
    ({ extensionState } = await import("./bridge-state.js"));
    ({ finalize } = await import("./permissions.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearExtensionState();
    debuggerMocks.forceDetachDebugger.mockResolvedValue(undefined);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("throws and preserves ownership metadata when Chrome does not close a created tab", async () => {
    const liveTab = {
      active: false,
      id: 51,
      status: "complete",
      url: "about:blank",
      windowId: 3
    } as chrome.tabs.Tab;
    extensionState.sessions.set("session-a", {
      clientId: "a",
      sessionId: "session-a",
      tabIds: new Set([51])
    });
    extensionState.registry.markCreated(51, "session-a", "UMB");
    getTabIfExists.mockResolvedValue(liveTab);
    vi.mocked(chrome.tabs.remove).mockResolvedValue(undefined);

    await expect(finalize("session-a", [], ["51"])).rejects.toThrow(
      "Chrome did not close UMB tab 51."
    );

    expect(chrome.tabs.remove).toHaveBeenCalledWith(51);
    expect(extensionState.sessions.get("session-a")?.tabIds.has(51)).toBe(true);
    expect(extensionState.registry.get(51)).toMatchObject({
      createdByUmb: true,
      sessionId: "session-a",
      tabId: 51
    });
  });
});
