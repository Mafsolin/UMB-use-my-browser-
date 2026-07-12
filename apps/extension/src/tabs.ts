import {
  extensionState,
  NAVIGATION_POLL_MS,
  NAVIGATION_TIMEOUT_MS,
  TAB_GROUP_TITLE,
  type SessionState,
  type SimplifiedTab,
  type StatusResponse
} from "./bridge-state.js";
import {
  attachDebugger,
  detachDebuggerNow,
  ensureControlledTab,
  forceDetachDebugger,
  runDebuggerCommand
} from "./debugger.js";
import { syncSessionStatus, getStatusResponse } from "./status.js";
import {
  isCommittedNavigation,
  isUsableNavigationState
} from "./background-runtime-helpers.js";

export function tabIdFromString(value: string): number {
  const tabId = Number(value);
  if (!Number.isInteger(tabId)) {
    throw new Error(`Invalid tab id: ${value}`);
  }
  return tabId;
}

export async function getTabIfExists(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

export async function getTabGroupTitle(groupId?: number): Promise<string | undefined> {
  if (groupId == null || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    return undefined;
  }
  try {
    const group = await chrome.tabGroups.get(groupId);
    return group.title;
  } catch {
    return undefined;
  }
}

export async function simplifyTab(
  tab: chrome.tabs.Tab,
  knownTabGroup?: string | null
): Promise<SimplifiedTab> {
  const entry = extensionState.registry.get(tab.id ?? -1);
  const tabGroup =
    knownTabGroup === null ? undefined : knownTabGroup ?? (await getTabGroupTitle(tab.groupId));
  return {
    id: String(tab.id),
    title: tab.title,
    url: tab.url,
    active: tab.active,
    kind:
      entry?.keptStatus ??
      (entry?.createdByUmb ? "temporary" : entry?.claimed ? "claimed" : "user"),
    tabGroup: entry?.tabGroup ?? tabGroup
  };
}

export function getSessionOrThrow(sessionId: string): SessionState {
  const session = extensionState.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown UMB session ${sessionId}.`);
  }
  return session;
}

export function recordTabForSession(sessionId: string, tabId: number) {
  const session = getSessionOrThrow(sessionId);
  session.tabIds.add(tabId);
}

export function removeTabFromSessions(tabId: number) {
  for (const session of extensionState.sessions.values()) {
    session.tabIds.delete(tabId);
  }
}

export function purgeTrackedTab(tabId: number) {
  extensionState.attachedTabs.delete(tabId);
  removeTabFromSessions(tabId);
  extensionState.registry.delete(tabId);
  syncSessionStatus();
}

export async function getActiveTabInWindow(windowId: number): Promise<chrome.tabs.Tab | undefined> {
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  return activeTab;
}

export async function getUmbTabGroupId(windowId: number): Promise<number | undefined> {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((group) => group.title === TAB_GROUP_TITLE)?.id;
}

export async function addTabToUmbGroup(
  tabId: number,
  windowId: number
): Promise<string | undefined> {
  try {
    const existingGroupId = await getUmbTabGroupId(windowId);
    const groupId =
      existingGroupId == null
        ? await chrome.tabs.group({ tabIds: [tabId] })
        : await chrome.tabs.group({ groupId: existingGroupId, tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { collapsed: false, title: TAB_GROUP_TITLE });
    return TAB_GROUP_TITLE;
  } catch (error) {
    console.warn("UMB could not group the tab.", error);
    return undefined;
  }
}

export async function cleanupStaleTemporaryTabs(): Promise<void> {
  const staleEntries = extensionState.registry
    .values()
    .filter((entry) => entry.createdByUmb && !entry.sessionId && !entry.keptStatus);
  for (const entry of staleEntries) {
    await detachDebuggerNow(entry.tabId);
    const liveTab = await getTabIfExists(entry.tabId);
    if (liveTab) {
      await chrome.tabs.remove(entry.tabId).catch(() => undefined);
    }
    extensionState.registry.delete(entry.tabId);
  }
  if (staleEntries.length > 0) {
    syncSessionStatus();
  }
}

export function looksUsable(url: string | undefined) {
  return Boolean(url && !url.startsWith("about:blank") && !url.startsWith("chrome://newtab"));
}

export function isUmbResidueTab(tab: chrome.tabs.Tab, tabGroup?: string): boolean {
  if (tab.id == null) {
    return false;
  }
  const entry = extensionState.registry.get(tab.id);
  return (
    (tab.url === "chrome://newtab/" || tab.url === "about:blank") &&
    tabGroup === TAB_GROUP_TITLE &&
    entry?.createdByUmb === true &&
    !entry.sessionId &&
    !entry.keptStatus
  );
}

async function getTabGroupTitles(
  tabs: chrome.tabs.Tab[]
): Promise<Map<number, string | undefined>> {
  const groupIds = [
    ...new Set(
      tabs
        .map((tab) => tab.groupId)
        .filter(
          (groupId): groupId is number =>
            groupId != null && groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
        )
    )
  ];
  const groupTitles = await Promise.all(
    groupIds.map(async (groupId) => [groupId, await getTabGroupTitle(groupId)] as const)
  );
  return new Map(groupTitles);
}

async function cleanupStaleUmbGroupResidueFromTabs(
  tabs: chrome.tabs.Tab[],
  groupTitles: Map<number, string | undefined>
): Promise<Set<number>> {
  const removedTabIds = new Set<number>();
  for (const tab of tabs) {
    if (tab.id == null) {
      continue;
    }
    const tabGroup =
      tab.groupId == null || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
        ? undefined
        : groupTitles.get(tab.groupId);
    if (!isUmbResidueTab(tab, tabGroup)) {
      continue;
    }
    await detachDebuggerNow(tab.id);
    await chrome.tabs.remove(tab.id).catch(() => undefined);
    extensionState.registry.delete(tab.id);
    removeTabFromSessions(tab.id);
    removedTabIds.add(tab.id);
  }
  syncSessionStatus();
  return removedTabIds;
}

export async function cleanupStaleUmbGroupResidue(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const groupTitles = await getTabGroupTitles(tabs);
  await cleanupStaleUmbGroupResidueFromTabs(tabs, groupTitles);
}

export async function probeTabState(
  _sessionId: string,
  tabId: number,
  tab?: chrome.tabs.Tab
) {
  const liveTab = tab ?? (await getTabIfExists(tabId));
  if (!liveTab) {
    purgeTrackedTab(tabId);
    throw new Error(`Tab ${tabId} is missing before readiness probing.`);
  }

  const fallback = {
    domReadable: Boolean(liveTab.title),
    href: liveTab.url ?? "",
    readyState: liveTab.status === "complete" ? "complete" : "loading",
    title: liveTab.title ?? ""
  };
  const probe = await runDebuggerCommand<{
    exceptionDetails?: { text?: string };
    result: {
      value?: {
        domReadable?: boolean;
        href?: string;
        readyState?: string;
        title?: string;
      };
    };
  }>(
    tabId,
    "Runtime.evaluate",
    {
      expression: `(() => ({
        href: location.href,
        readyState: document.readyState,
        title: document.title,
        domReadable: Boolean(document.title || document.documentElement?.hasChildNodes())
      }))()`,
      returnByValue: true,
      awaitPromise: true
    },
    "evaluate"
  )
    .then((result) =>
      result.exceptionDetails ? fallback : (result.result.value ?? fallback)
    )
    .catch(() => fallback);

  return {
    ...fallback,
    ...probe,
    status: liveTab.status,
    url: liveTab.url
  };
}

export async function waitForUsableNavigation(
  sessionId: string,
  tabId: number,
  requestedUrl: string,
  initialUrl?: string
): Promise<void> {
  const startedAt = Date.now();
  let sawCommittedUrl = false;

  while (Date.now() - startedAt < NAVIGATION_TIMEOUT_MS) {
    const tab = await getTabIfExists(tabId);
    if (!tab) {
      purgeTrackedTab(tabId);
      throw new Error(`Tab ${tabId} is missing before navigation became usable.`);
    }

    const state = await probeTabState(sessionId, tabId, tab);
    if (isCommittedNavigation(state, requestedUrl, initialUrl)) {
      sawCommittedUrl = true;
    }

    if (sawCommittedUrl && isUsableNavigationState(state, requestedUrl, initialUrl)) {
      return;
    }

    if (requestedUrl.startsWith("data:") && !sawCommittedUrl && looksUsable(tab.url)) {
      throw new Error(`Comet blocked navigation to ${requestedUrl} on tab ${tabId}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, NAVIGATION_POLL_MS));
  }

  if (!sawCommittedUrl) {
    throw new Error(`Navigation never committed for tab ${tabId}.`);
  }
  throw new Error(`Timed out before tab ${tabId} reached a usable page state.`);
}

export async function startSession(
  sessionId: string,
  clientId: string,
  name?: string
): Promise<StatusResponse> {
  const existing = extensionState.sessions.get(sessionId);
  if (existing) {
    existing.name = name ?? existing.name;
    extensionState.activeSessionId = sessionId;
    syncSessionStatus();
    return getStatusResponse();
  }

  await cleanupDanglingSessionEntries();
  await cleanupStaleTemporaryTabs();
  await cleanupStaleUmbGroupResidue();

  extensionState.sessions.set(sessionId, {
    clientId,
    name,
    sessionId,
    tabIds: new Set<number>()
  });
  extensionState.activeSessionId = sessionId;
  syncSessionStatus();
  return getStatusResponse();
}

export async function openTabs(): Promise<SimplifiedTab[]> {
  await cleanupStaleTemporaryTabs();
  const tabs = await chrome.tabs.query({});
  const groupTitles = await getTabGroupTitles(tabs);
  const removedTabIds = await cleanupStaleUmbGroupResidueFromTabs(tabs, groupTitles);
  const eligibleTabs = tabs.filter((tab) => tab.id != null && !removedTabIds.has(tab.id));
  return Promise.all(
    eligibleTabs.map((tab) =>
      simplifyTab(
        tab,
        tab.groupId == null || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
          ? null
          : (groupTitles.get(tab.groupId) ?? null)
      )
    )
  );
}

export async function claimTab(sessionId: string, tabId: number): Promise<SimplifiedTab> {
  getSessionOrThrow(sessionId);
  const registryOwner = extensionState.registry.get(tabId)?.sessionId;
  const liveOwner = [...extensionState.sessions.values()].find(
    (session) =>
      session.sessionId !== sessionId &&
      (session.tabIds.has(tabId) || registryOwner === session.sessionId)
  );
  if (liveOwner) {
    throw new Error(
      `Tab ${tabId} is already controlled by UMB session ${liveOwner.sessionId}.`
    );
  }

  const tab = await getTabIfExists(tabId);
  if (!tab) {
    purgeTrackedTab(tabId);
    throw new Error(`No tab with id: ${tabId}.`);
  }

  try {
    await attachDebugger(tabId, "background");
  } catch (backgroundError) {
    const previousActiveTab =
      tab.windowId != null ? await getActiveTabInWindow(tab.windowId) : undefined;
    try {
      await chrome.tabs.update(tabId, { active: true });
      await attachDebugger(tabId, "foreground");
    } catch (foregroundError) {
      await forceDetachDebugger(tabId);
      const backgroundMessage =
        backgroundError instanceof Error ? backgroundError.message : String(backgroundError);
      const foregroundMessage =
        foregroundError instanceof Error ? foregroundError.message : String(foregroundError);
      throw new Error(
        `Debugger attach failed for claimed tab ${tabId}. Background attempt: ${backgroundMessage}. Foreground retry: ${foregroundMessage}.`
      );
    } finally {
      if (previousActiveTab?.id != null && previousActiveTab.id !== tabId) {
        await chrome.tabs.update(previousActiveTab.id, { active: true }).catch(() => undefined);
      }
    }
  }

  recordTabForSession(sessionId, tabId);
  extensionState.registry.markClaimed(tabId, sessionId);
  return simplifyTab((await getTabIfExists(tabId)) ?? tab);
}

export async function newTab(sessionId: string, url?: string): Promise<SimplifiedTab> {
  getSessionOrThrow(sessionId);
  await cleanupStaleTemporaryTabs();

  const createdTab = await chrome.tabs.create({ active: false, url: url ?? "about:blank" });
  const createdTabId = createdTab.id;
  try {
    if (createdTabId == null || createdTab.windowId == null) {
      throw new Error("Chrome did not return a tab id.");
    }

    const tabGroup = await addTabToUmbGroup(createdTabId, createdTab.windowId);
    const canonicalTab = await getTabIfExists(createdTabId);
    if (canonicalTab?.id == null) {
      throw new Error(`New UMB tab ${createdTabId} disappeared before it became stable.`);
    }

    extensionState.registry.markCreated(canonicalTab.id, sessionId, tabGroup);
    recordTabForSession(sessionId, canonicalTab.id);
    await attachDebugger(canonicalTab.id);
    if (url) {
      await waitForUsableNavigation(sessionId, canonicalTab.id, url, "about:blank");
    }
    return await simplifyTab(canonicalTab);
  } catch (error) {
    if (createdTabId != null) {
      await forceDetachDebugger(createdTabId).catch(() => undefined);
      await chrome.tabs.remove(createdTabId).catch(() => undefined);
      purgeTrackedTab(createdTabId);
    }
    throw error;
  }
}

export async function goto(sessionId: string, tabId: number, url: string): Promise<void> {
  const tab = await ensureControlledTab(sessionId, tabId);
  const initialUrl = tab.url;
  const result = await runDebuggerCommand<{ errorText?: string }>(
    tabId,
    "Page.navigate",
    { url },
    "navigate"
  );
  if (result?.errorText) {
    throw new Error(`Browser blocked navigation to ${url} on tab ${tabId}: ${result.errorText}`);
  }
  await waitForUsableNavigation(sessionId, tabId, url, initialUrl);
}

export async function getUrl(sessionId: string, tabId: number): Promise<string | undefined> {
  return (await ensureControlledTab(sessionId, tabId)).url;
}

export async function getTitle(sessionId: string, tabId: number): Promise<string | undefined> {
  return (await ensureControlledTab(sessionId, tabId)).title;
}

export async function nameSession(
  sessionId: string,
  name: string
): Promise<StatusResponse> {
  const session = extensionState.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown UMB session ${sessionId}.`);
  }
  session.name = name;
  extensionState.activeSessionId = sessionId;
  syncSessionStatus();
  return getStatusResponse();
}

async function cleanupDanglingSessionEntries(): Promise<void> {
  const danglingEntries = extensionState.registry
    .values()
    .filter((entry) => entry.sessionId && !extensionState.sessions.has(entry.sessionId));
  for (const entry of danglingEntries) {
    await detachDebuggerNow(entry.tabId);
    removeTabFromSessions(entry.tabId);
    if (entry.createdByUmb && !entry.keptStatus) {
      const liveTab = await getTabIfExists(entry.tabId);
      if (liveTab) {
        await chrome.tabs.remove(entry.tabId).catch(() => undefined);
      }
      extensionState.registry.delete(entry.tabId);
      continue;
    }
    extensionState.registry.markDetached(entry.tabId);
  }
  if (danglingEntries.length > 0) {
    syncSessionStatus();
  }
}
