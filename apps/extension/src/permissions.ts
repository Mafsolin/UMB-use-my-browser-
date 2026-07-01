import {
  DETACH_VERIFY_ATTEMPTS,
  DETACH_VERIFY_DELAY_MS,
  extensionState,
  type SessionState
} from "./bridge-state.js";
import {
  detachDebuggerNow,
  forceDetachDebugger,
  refreshAttachedTabsFromBrowser
} from "./debugger.js";
import { getTabIfExists, removeTabFromSessions, tabIdFromString } from "./tabs.js";
import { syncSessionStatus, updateStatus } from "./status.js";

export type FinalizeKeepEntry = { id: string; status: "deliverable" | "handoff" };
export type FinalizeResponse = {
  kept: FinalizeKeepEntry[];
  closed: string[];
  released: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function cleanupDanglingSessionEntries(): Promise<void> {
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

export async function verifyDetachedTabs(tabIds: Iterable<number>): Promise<number[]> {
  const ids = [...new Set([...tabIds])];
  for (let attempt = 0; attempt < DETACH_VERIFY_ATTEMPTS; attempt += 1) {
    await refreshAttachedTabsFromBrowser();
    const stillAttached = ids.filter((tabId) => extensionState.attachedTabs.has(tabId));
    if (stillAttached.length === 0) {
      return [];
    }
    for (const tabId of stillAttached) {
      await forceDetachDebugger(tabId);
    }
    if (attempt < DETACH_VERIFY_ATTEMPTS - 1) {
      await sleep(DETACH_VERIFY_DELAY_MS);
    }
  }
  await refreshAttachedTabsFromBrowser();
  return ids.filter((tabId) => extensionState.attachedTabs.has(tabId));
}

function getSessionOrThrow(sessionId: string): SessionState {
  const session = extensionState.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown UMB session ${sessionId}.`);
  }
  return session;
}

export function getSessionById(sessionId: string): SessionState | undefined {
  return extensionState.sessions.get(sessionId);
}

export async function finalize(
  sessionId: string,
  keep: FinalizeKeepEntry[],
  ownedTabIds: string[]
): Promise<FinalizeResponse> {
  const session = extensionState.sessions.get(sessionId);
  if (!session) {
    return { kept: keep, closed: [], released: [] };
  }

  const keepIds = new Set(keep.map((entry) => tabIdFromString(entry.id)));
  const registryTabIds = extensionState.registry
    .valuesForSession(sessionId)
    .map((entry) => entry.tabId);
  const attachedTabIds = [
    ...new Set(
      [...extensionState.attachedTabs].filter(
        (tabId) => session.tabIds.has(tabId) || registryTabIds.includes(tabId)
      )
    )
  ];
  const trackedIds = [
    ...new Set<number>([
      ...ownedTabIds.map((entry) => Number(entry)).filter(Number.isInteger),
      ...session.tabIds,
      ...registryTabIds,
      ...attachedTabIds
    ])
  ];
  const closed: string[] = [];
  const released: string[] = [];

  for (const entry of keep) {
    extensionState.registry.markKeep(tabIdFromString(entry.id), entry.status);
  }

  for (const trackedId of trackedIds) {
    const entry = extensionState.registry.get(trackedId) ?? {
      tabId: trackedId,
      createdByUmb: false,
      claimed: true
    };
    await forceDetachDebugger(entry.tabId);
    session.tabIds.delete(entry.tabId);
    const liveTab = await getTabIfExists(entry.tabId);

    if (keepIds.has(entry.tabId)) {
      extensionState.registry.markDetached(entry.tabId);
      continue;
    }
    if (entry.createdByUmb) {
      if (liveTab) {
        await chrome.tabs.remove(entry.tabId).catch(() => undefined);
      }
      closed.push(String(entry.tabId));
      extensionState.registry.delete(entry.tabId);
      continue;
    }
    if (!liveTab) {
      extensionState.registry.delete(entry.tabId);
      continue;
    }
    extensionState.registry.markDetached(entry.tabId);
    released.push(String(entry.tabId));
  }

  const stillAttached = await verifyDetachedTabs(trackedIds);
  if (stillAttached.length > 0) {
    const reasonDetails = stillAttached
      .map(
        (tabId) =>
          `${tabId}${extensionState.lastDetachReasons.get(tabId) ? `:${extensionState.lastDetachReasons.get(tabId)}` : ""}`
      )
      .join(", ");
    updateStatus({
      lastError: `UMB завершил сессию, но браузер все еще держал attach для вкладок: ${reasonDetails}.`
    });
  }

  extensionState.sessions.delete(sessionId);
  if (extensionState.activeSessionId === sessionId) {
    extensionState.activeSessionId = [...extensionState.sessions.keys()].at(-1);
  }
  await cleanupDanglingSessionEntries();
  syncSessionStatus();

  return { kept: keep, closed, released };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void detachDebuggerNow(tabId);
  extensionState.attachedTabs.delete(tabId);
  removeTabFromSessions(tabId);
  extensionState.registry.delete(tabId);
  syncSessionStatus();
});

void getSessionOrThrow;
