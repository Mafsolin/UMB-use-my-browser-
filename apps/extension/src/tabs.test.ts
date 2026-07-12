import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const debuggerMocks = vi.hoisted(() => ({
  attachDebugger: vi.fn(),
  detachDebuggerNow: vi.fn(),
  ensureControlledTab: vi.fn(),
  forceDetachDebugger: vi.fn(),
  runDebuggerCommand: vi.fn()
}));
const evaluateOnControlledTab = vi.hoisted(() => vi.fn());

vi.mock("./debugger.js", () => debuggerMocks);
vi.mock("./dom.js", () => ({ evaluateOnControlledTab }));
vi.mock("./status.js", () => ({
  getStatusResponse: vi.fn(() => ({ clientLabel: "test" })),
  syncSessionStatus: vi.fn()
}));

let extensionState: typeof import("./bridge-state.js").extensionState;
let claimTab: typeof import("./tabs.js").claimTab;
let cleanupStaleTemporaryTabs: typeof import("./tabs.js").cleanupStaleTemporaryTabs;
let goto: typeof import("./tabs.js").goto;
let isUmbResidueTab: typeof import("./tabs.js").isUmbResidueTab;
let newTab: typeof import("./tabs.js").newTab;

const tabsCreate = vi.fn<() => Promise<chrome.tabs.Tab>>();
const tabsGet = vi.fn();
const tabsRemove = vi.fn();

function clearExtensionState() {
  extensionState.sessions.clear();
  extensionState.activeSessionId = undefined;
  extensionState.attachedTabs.clear();
  extensionState.lastDetachReasons.clear();
  for (const entry of extensionState.registry.values()) {
    extensionState.registry.delete(entry.tabId);
  }
}

describe("tab lifecycle", () => {
  beforeAll(async () => {
    vi.stubGlobal("chrome", {
      action: {
        setBadgeBackgroundColor: vi.fn(),
        setBadgeText: vi.fn()
      },
      tabGroups: {
        TAB_GROUP_ID_NONE: -1,
        get: vi.fn(),
        query: vi.fn(async () => []),
        update: vi.fn()
      },
      tabs: {
        create: tabsCreate,
        get: tabsGet,
        group: vi.fn(async () => 1),
        query: vi.fn(async () => []),
        remove: tabsRemove,
        update: vi.fn()
      }
    });
    ({ extensionState } = await import("./bridge-state.js"));
    ({ claimTab, cleanupStaleTemporaryTabs, goto, isUmbResidueTab, newTab } =
      await import("./tabs.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    clearExtensionState();
    debuggerMocks.forceDetachDebugger.mockResolvedValue(undefined);
    tabsRemove.mockResolvedValue(undefined);
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects claiming a tab owned by another live session", async () => {
    extensionState.sessions.set("session-a", {
      clientId: "a",
      sessionId: "session-a",
      tabIds: new Set([41])
    });
    extensionState.sessions.set("session-b", {
      clientId: "b",
      sessionId: "session-b",
      tabIds: new Set()
    });
    extensionState.registry.markClaimed(41, "session-a");

    await expect(claimTab("session-b", 41)).rejects.toThrow(
      "Tab 41 is already controlled by UMB session session-a."
    );

    expect(debuggerMocks.attachDebugger).not.toHaveBeenCalled();
    expect(extensionState.sessions.get("session-a")?.tabIds.has(41)).toBe(true);
    expect(extensionState.sessions.get("session-b")?.tabIds.has(41)).toBe(false);
    expect(extensionState.registry.get(41)?.sessionId).toBe("session-a");
  });

  it("closes and purges a created tab when debugger attach fails", async () => {
    const createdTab = {
      active: false,
      id: 42,
      status: "complete",
      url: "about:blank",
      windowId: 3
    } as chrome.tabs.Tab;
    extensionState.sessions.set("session-a", {
      clientId: "a",
      sessionId: "session-a",
      tabIds: new Set()
    });
    tabsCreate.mockResolvedValue(createdTab);
    tabsGet.mockResolvedValue(createdTab);
    debuggerMocks.attachDebugger.mockRejectedValueOnce(new Error("attach failed"));

    await expect(newTab("session-a")).rejects.toThrow("attach failed");

    expect(debuggerMocks.forceDetachDebugger).toHaveBeenCalledWith(42);
    expect(tabsRemove).toHaveBeenCalledWith(42);
    expect(extensionState.sessions.get("session-a")?.tabIds.has(42)).toBe(false);
    expect(extensionState.registry.get(42)).toBeUndefined();
  });

  it("keeps a finalized deliverable during stale temporary-tab cleanup", async () => {
    extensionState.registry.markCreated(44, "session-a", "UMB");
    extensionState.registry.markKeep(44, "deliverable");
    extensionState.registry.markDetached(44);

    await cleanupStaleTemporaryTabs();

    expect(debuggerMocks.detachDebuggerNow).not.toHaveBeenCalled();
    expect(tabsRemove).not.toHaveBeenCalled();
    expect(extensionState.registry.get(44)).toMatchObject({
      createdByUmb: true,
      keptStatus: "deliverable",
      tabId: 44
    });
  });

  it("does not classify an untracked user blank tab as UMB residue", () => {
    const userTab = {
      active: false,
      id: 45,
      url: "about:blank",
      windowId: 3
    } as chrome.tabs.Tab;

    expect(isUmbResidueTab(userTab, "UMB")).toBe(false);
  });

  it("does not treat the pre-navigation page as a committed goto and accepts a redirect", async () => {
    vi.useFakeTimers();
    const initialUrl = "https://old.example/";
    const requestedUrl = "https://requested.example/";
    const redirectedUrl = "https://redirected.example/";
    extensionState.sessions.set("session-a", {
      clientId: "a",
      sessionId: "session-a",
      tabIds: new Set([43])
    });
    tabsGet.mockResolvedValue({
      active: false,
      id: 43,
      status: "complete",
      url: initialUrl,
      windowId: 3
    } as chrome.tabs.Tab);
    debuggerMocks.runDebuggerCommand.mockResolvedValue({});

    let probe = 0;
    evaluateOnControlledTab.mockImplementation(
      async (_sessionId: string, _tabId: number, expression: string) => {
        if (expression === "location.href") {
          probe += 1;
          return probe === 1 ? initialUrl : redirectedUrl;
        }
        if (expression === "document.readyState") {
          return "complete";
        }
        if (expression === "document.title") {
          return probe === 1 ? "Old page" : "Redirected page";
        }
        return "<html><body>loaded</body></html>";
      }
    );

    const navigation = goto("session-a", 43, requestedUrl);
    await vi.advanceTimersByTimeAsync(250);
    await expect(navigation).resolves.toBeUndefined();

    expect(evaluateOnControlledTab).toHaveBeenCalledTimes(8);
  });
});
