import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const debuggerMocks = vi.hoisted(() => ({
  attachDebugger: vi.fn(),
  detachDebuggerNow: vi.fn(),
  ensureControlledTab: vi.fn(),
  forceDetachDebugger: vi.fn(),
  runDebuggerCommand: vi.fn()
}));

vi.mock("./debugger.js", () => debuggerMocks);
vi.mock("./status.js", () => ({
  getStatusResponse: vi.fn(() => ({ clientLabel: "test" })),
  syncSessionStatus: vi.fn()
}));

let extensionState: typeof import("./bridge-state.js").extensionState;
let claimTab: typeof import("./tabs.js").claimTab;
let cleanupStaleTemporaryTabs: typeof import("./tabs.js").cleanupStaleTemporaryTabs;
let getTitle: typeof import("./tabs.js").getTitle;
let getUrl: typeof import("./tabs.js").getUrl;
let goto: typeof import("./tabs.js").goto;
let isUmbResidueTab: typeof import("./tabs.js").isUmbResidueTab;
let newTab: typeof import("./tabs.js").newTab;
let openTabs: typeof import("./tabs.js").openTabs;
let startSession: typeof import("./tabs.js").startSession;

const tabGroupsGet = vi.fn();
const tabsCreate = vi.fn<() => Promise<chrome.tabs.Tab>>();
const tabsGet = vi.fn();
const tabsQuery = vi.fn(async () => [] as chrome.tabs.Tab[]);
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
        get: tabGroupsGet,
        query: vi.fn(async () => []),
        update: vi.fn()
      },
      tabs: {
        create: tabsCreate,
        get: tabsGet,
        group: vi.fn(async () => 1),
        query: tabsQuery,
        remove: tabsRemove,
        update: vi.fn()
      }
    });
    ({ extensionState } = await import("./bridge-state.js"));
    ({
      claimTab,
      cleanupStaleTemporaryTabs,
      getTitle,
      getUrl,
      goto,
      isUmbResidueTab,
      newTab,
      openTabs,
      startSession
    } = await import("./tabs.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    clearExtensionState();
    debuggerMocks.forceDetachDebugger.mockResolvedValue(undefined);
    tabsQuery.mockResolvedValue([]);
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
    let probe = 0;
    debuggerMocks.runDebuggerCommand.mockImplementation(
      async (_tabId: number, method: string) => {
        if (method !== "Runtime.evaluate") {
          return {};
        }
        probe += 1;
        return {
          result: {
            value:
              probe === 1
                ? {
                    domReadable: true,
                    href: initialUrl,
                    readyState: "complete",
                    title: "Old page"
                  }
                : {
                    domReadable: true,
                    href: redirectedUrl,
                    readyState: "complete",
                    title: "Redirected page"
                  }
          }
        };
      }
    );
    debuggerMocks.ensureControlledTab.mockResolvedValue({
      active: false,
      id: 43,
      status: "complete",
      url: initialUrl,
      windowId: 3
    } as chrome.tabs.Tab);

    const navigation = goto("session-a", 43, requestedUrl);
    await vi.advanceTimersByTimeAsync(250);
    await expect(navigation).resolves.toBeUndefined();

    expect(debuggerMocks.runDebuggerCommand).toHaveBeenCalledTimes(3);
    expect(
      debuggerMocks.runDebuggerCommand.mock.calls.filter((call) => call[1] === "Runtime.evaluate")
    ).toHaveLength(2);
    expect(tabsGet).toHaveBeenCalledTimes(2);
  });

  it("uses the existing-session fast path before cleanup queries", async () => {
    extensionState.sessions.set("session-a", {
      clientId: "a",
      name: "Old name",
      sessionId: "session-a",
      tabIds: new Set([43])
    });

    await startSession("session-a", "a", "Updated name");

    expect(extensionState.sessions.get("session-a")?.name).toBe("Updated name");
    expect(tabsQuery).not.toHaveBeenCalled();
    expect(debuggerMocks.detachDebuggerNow).not.toHaveBeenCalled();
  });

  it("reuses the validated controlled tab for url and title", async () => {
    const tab = {
      active: false,
      id: 46,
      title: "Example",
      url: "https://example.com/",
      windowId: 3
    } as chrome.tabs.Tab;
    debuggerMocks.ensureControlledTab.mockResolvedValue(tab);

    await expect(getUrl("session-a", 46)).resolves.toBe("https://example.com/");
    await expect(getTitle("session-a", 46)).resolves.toBe("Example");

    expect(debuggerMocks.ensureControlledTab).toHaveBeenCalledTimes(2);
    expect(tabsGet).not.toHaveBeenCalled();
  });

  it("queries tabs once and resolves each group once when opening tabs", async () => {
    tabsQuery.mockResolvedValue([
      { active: true, groupId: 7, id: 47, title: "One", url: "https://one.test/" },
      { active: false, groupId: 7, id: 48, title: "Two", url: "https://two.test/" },
      { active: false, groupId: -1, id: 49, title: "Three", url: "https://three.test/" }
    ] as chrome.tabs.Tab[]);
    tabGroupsGet.mockResolvedValue({ id: 7, title: "Work" });

    await expect(openTabs()).resolves.toHaveLength(3);

    expect(tabsQuery).toHaveBeenCalledTimes(1);
    expect(tabGroupsGet).toHaveBeenCalledTimes(1);
    expect(tabGroupsGet).toHaveBeenCalledWith(7);
    expect(tabsRemove).not.toHaveBeenCalled();
  });
});
