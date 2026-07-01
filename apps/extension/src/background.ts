import { TabRegistry } from "./tab-registry.js";
import {
  collectFinalizeTabIds,
  filterAttachedTabIdsForSession,
  isCommittedNavigation,
  isUsableNavigationState
} from "./background-runtime-helpers.js";
import type { ExtensionRequest, ExtensionResponse } from "./messages.js";

const DAEMON_URL = "ws://127.0.0.1:44777/extension";
const DEBUGGER_VERSION = "1.3";
const NATIVE_HOST_NAME = "com.umb.use_my_browser";
const SOCKET_RECONNECT_DELAY_MS = 1_500;
const NATIVE_RECONNECT_DELAY_MS = 1_500;
const SESSION_CLEANUP_DELAY_MS = 5_000;
const DEBUGGER_STAGE_TIMEOUT_MS = 5_000;
const DEBUGGER_DETACH_TIMEOUT_MS = 1_500;
const DETACH_VERIFY_ATTEMPTS = 3;
const DETACH_VERIFY_DELAY_MS = 250;
const NAVIGATION_TIMEOUT_MS = 15_000;
const NAVIGATION_POLL_MS = 250;
const TAB_GROUP_TITLE = "UMB";

const registry = new TabRegistry();
let socket: WebSocket | undefined;
let socketUrl = DAEMON_URL;
let socketReconnectTimer: number | undefined;
let sessionCleanupTimer: number | undefined;
let nativePort: chrome.runtime.Port | undefined;
let nativeReconnectTimer: number | undefined;
const extensionStartedAt = new Date().toISOString();

type BootstrapStatus = {
  daemonHttpUrl?: string;
  daemonPid?: number;
  daemonStartedAt?: string;
  hostName?: string;
  nativeHostPid?: number;
  wsUrl?: string;
};

type UiStatus = BootstrapStatus & {
  activeDebuggerSessions?: number;
  attachedTabCount?: number;
  connected: boolean;
  connectedProcessLabel?: string;
  extensionStartedAt: string;
  lastConnectedAt?: string;
  lastError?: string;
  sessionActive: boolean;
  sessionId?: string;
  sessionName?: string;
};

type DebuggerStage =
  | "attach"
  | "runtime-enable"
  | "page-enable"
  | "navigate"
  | "evaluate"
  | "screenshot"
  | "detach";

type DebuggerAttachMode = "background" | "foreground";

type SessionState = {
  clientId: string;
  name?: string;
  sessionId: string;
  tabIds: Set<number>;
};

type StatusResponse = {
  attachedTabCount?: number;
  clientLabel: string;
  connectedProcessLabel?: string;
  sessionActive?: boolean;
  sessionId?: string;
  sessionName?: string;
};

type DaemonHealthResponse = {
  daemon?: {
    pid?: number;
    startedAt?: string;
  };
};

const uiStatus: UiStatus = {
  activeDebuggerSessions: 0,
  attachedTabCount: 0,
  connected: false,
  extensionStartedAt,
  sessionActive: false
};

const sessions = new Map<string, SessionState>();
let activeSessionId: string | undefined;
const attachedTabs = new Set<number>();
const lastDetachReasons = new Map<number, string>();

function tabIdFromString(value: string): number {
  const tabId = Number(value);
  if (!Number.isInteger(tabId)) {
    throw new Error(`Invalid tab id: ${value}`);
  }

  return tabId;
}

async function getTabIfExists(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

async function getTabGroupTitle(groupId?: number): Promise<string | undefined> {
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

async function simplifyTab(tab: chrome.tabs.Tab) {
  const entry = registry.get(tab.id ?? -1);
  const tabGroup = await getTabGroupTitle(tab.groupId);

  return {
    id: String(tab.id),
    title: tab.title,
    url: tab.url,
    active: tab.active,
    kind: entry?.keptStatus ?? (entry?.createdByUmb ? "temporary" : entry?.claimed ? "claimed" : "user"),
    tabGroup: entry?.tabGroup ?? tabGroup
  };
}

function updateBadge() {
  const text = uiStatus.connected ? "ON" : "OFF";
  const color = uiStatus.connected ? "#157347" : "#a61e4d";
  void chrome.action.setBadgeText({ text });
  void chrome.action.setBadgeBackgroundColor({ color });
}

function updateStatus(next: Partial<UiStatus>) {
  Object.assign(uiStatus, next);
  updateBadge();
}

function syncSessionStatus() {
  const session = activeSessionId ? sessions.get(activeSessionId) : undefined;
  updateStatus({
    activeDebuggerSessions: attachedTabs.size,
    attachedTabCount: attachedTabs.size,
    connectedProcessLabel: uiStatus.daemonPid ? `daemon:${uiStatus.daemonPid}` : undefined,
    sessionActive: Boolean(session),
    sessionId: session?.sessionId,
    sessionName: session?.name
  });
}

function getStatusSnapshot(): UiStatus {
  return {
    ...uiStatus
  };
}

function getStatusResponse(): StatusResponse {
  return {
    attachedTabCount: uiStatus.attachedTabCount,
    clientLabel: "UMB Chrome extension",
    connectedProcessLabel: uiStatus.connectedProcessLabel,
    sessionActive: uiStatus.sessionActive,
    sessionId: uiStatus.sessionId,
    sessionName: uiStatus.sessionName
  };
}

function clearSessionCleanupTimer() {
  if (sessionCleanupTimer == null) {
    return;
  }

  clearTimeout(sessionCleanupTimer);
  sessionCleanupTimer = undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = DEBUGGER_STAGE_TIMEOUT_MS
): Promise<T> {
  return await Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    })
  ]);
}

async function refreshAttachedTabsFromBrowser(): Promise<void> {
  try {
    const targets = await chrome.debugger.getTargets();
    attachedTabs.clear();
    for (const target of targets) {
      if (target.attached && Number.isInteger(target.tabId)) {
        attachedTabs.add(target.tabId as number);
      }
    }
  } catch {
    // Ignore target introspection failures and keep local runtime state.
  } finally {
    syncSessionStatus();
  }
}

async function runDebuggerCommand<T>(
  tabId: number,
  method: string,
  commandParams: Record<string, unknown> | undefined,
  stage: DebuggerStage
): Promise<T> {
  return await withTimeout(
    chrome.debugger.sendCommand({ tabId }, method, commandParams) as unknown as Promise<T>,
    `Debugger ${stage} for tab ${tabId}`
  );
}

function describeDebuggerError(
  tabId: number,
  stage: DebuggerStage,
  error: unknown
): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) {
    return new Error(`Debugger ${stage} timeout for tab ${tabId}.`);
  }

  if (/No tab with id/i.test(message)) {
    return new Error(`Debugger ${stage} failed because tab ${tabId} disappeared.`);
  }

  if (/Cannot access a chrome/i.test(message) || /restricted/i.test(message)) {
    return new Error(`Debugger ${stage} failed on restricted browser page for tab ${tabId}.`);
  }

  return new Error(`Debugger ${stage} failed for tab ${tabId}: ${message}`);
}

async function attachDebugger(tabId: number, mode: DebuggerAttachMode = "background"): Promise<void> {
  await refreshAttachedTabsFromBrowser();
  if (attachedTabs.has(tabId)) {
    return;
  }

  const liveTab = await getTabIfExists(tabId);
  if (!liveTab) {
    throw new Error(`Debugger attach failed because tab ${tabId} disappeared.`);
  }

  const tabDescriptor = { tabId };
  try {
    await withTimeout(
      chrome.debugger.attach(tabDescriptor, DEBUGGER_VERSION),
      `Debugger attach for tab ${tabId}`
    );
  } catch (error) {
    await forceDetachDebugger(tabId);
    throw new Error(
      `Debugger attach failed for tab ${tabId} (${mode}): ${describeDebuggerError(tabId, "attach", error).message}`
    );
  }

  try {
    await runDebuggerCommand(tabId, "Runtime.enable", undefined, "runtime-enable");
  } catch (error) {
    await forceDetachDebugger(tabId);
    throw new Error(
      `Debugger attach failed for tab ${tabId} (${mode}): ${describeDebuggerError(tabId, "runtime-enable", error).message}`
    );
  }

  try {
    await runDebuggerCommand(tabId, "Page.enable", undefined, "page-enable");
    attachedTabs.add(tabId);
    lastDetachReasons.delete(tabId);
    await refreshAttachedTabsFromBrowser();
  } catch (error) {
    await forceDetachDebugger(tabId);
    throw new Error(
      `Debugger attach failed for tab ${tabId} (${mode}): ${describeDebuggerError(tabId, "page-enable", error).message}`
    );
  }
}

async function forceDetachDebugger(tabId: number): Promise<void> {
  try {
    await withTimeout(
      chrome.debugger.detach({ tabId }),
      `Debugger detach for tab ${tabId}`,
      DEBUGGER_DETACH_TIMEOUT_MS
    );
  } catch {
    // Ignore detach races and already-detached states.
  } finally {
    attachedTabs.delete(tabId);
    await refreshAttachedTabsFromBrowser();
  }
}

async function detachDebuggerNow(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) {
    await refreshAttachedTabsFromBrowser();
    if (!attachedTabs.has(tabId)) {
      return;
    }
  }

  await forceDetachDebugger(tabId);
}

function removeTabFromSessions(tabId: number) {
  for (const session of sessions.values()) {
    session.tabIds.delete(tabId);
  }
}

function purgeTrackedTab(tabId: number): void {
  attachedTabs.delete(tabId);
  removeTabFromSessions(tabId);
  registry.delete(tabId);
  syncSessionStatus();
}

function getSessionOrThrow(sessionId: string): SessionState {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown UMB session ${sessionId}.`);
  }

  return session;
}

function recordTabForSession(sessionId: string, tabId: number) {
  const session = getSessionOrThrow(sessionId);
  session.tabIds.add(tabId);
}

async function ensureControlledTab(sessionId: string, tabId: number): Promise<void> {
  const session = getSessionOrThrow(sessionId);
  if (!session.tabIds.has(tabId)) {
    throw new Error(`Tab ${tabId} is not controlled by UMB session ${sessionId}.`);
  }

  const liveTab = await getTabIfExists(tabId);
  if (!liveTab) {
    purgeTrackedTab(tabId);
    throw new Error(`No tab with id: ${tabId}.`);
  }

  await attachDebugger(tabId);
}

async function evaluateOnControlledTab<T>(
  sessionId: string,
  tabId: number,
  expression: string
): Promise<T> {
  await ensureControlledTab(sessionId, tabId);
  const result = await runDebuggerCommand<{
    exceptionDetails?: { text?: string };
    result: { value?: T };
  }>(
    tabId,
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true
    },
    "evaluate"
  );

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? `Debugger evaluation failed on tab ${tabId}.`);
  }

  return result.result.value as T;
}

async function getUmbTabGroupId(windowId: number): Promise<number | undefined> {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((group) => group.title === TAB_GROUP_TITLE)?.id;
}

async function addTabToUmbGroup(tabId: number, windowId: number): Promise<string | undefined> {
  try {
    const existingGroupId = await getUmbTabGroupId(windowId);
    const groupId = existingGroupId == null
      ? await chrome.tabs.group({ tabIds: [tabId] })
      : await chrome.tabs.group({ groupId: existingGroupId, tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, {
      collapsed: false,
      title: TAB_GROUP_TITLE
    });
    return TAB_GROUP_TITLE;
  } catch (error) {
    console.warn("UMB could not group the tab.", error);
    return undefined;
  }
}

async function probeTabState(sessionId: string, tabId: number) {
  const tab = await getTabIfExists(tabId);
  if (!tab) {
    purgeTrackedTab(tabId);
    throw new Error(`Tab ${tabId} is missing before readiness probing.`);
  }

  const href = await evaluateOnControlledTab<string>(sessionId, tabId, "location.href").catch(() => tab.url ?? "");
  const readyState = await evaluateOnControlledTab<string>(sessionId, tabId, "document.readyState").catch(() => (
    tab.status === "complete" ? "complete" : "loading"
  ));
  const title = await evaluateOnControlledTab<string>(sessionId, tabId, "document.title").catch(() => tab.title ?? "");
  const documentHtml = await evaluateOnControlledTab<string>(
    sessionId,
    tabId,
    "document.documentElement?.outerHTML ?? ''"
  ).catch(() => "");

  return {
    documentHtml,
    href,
    readyState,
    status: tab.status,
    title,
    url: tab.url
  };
}

function looksUsable(url: string | undefined) {
  return Boolean(url && !url.startsWith("about:blank") && !url.startsWith("chrome://newtab"));
}

function isUmbResidueTab(tab: chrome.tabs.Tab, tabGroup?: string): boolean {
  if (tab.id == null) {
    return false;
  }

  const entry = registry.get(tab.id);
  return (
    (tab.url === "chrome://newtab/" || tab.url === "about:blank") &&
    tabGroup === TAB_GROUP_TITLE &&
    !entry?.sessionId &&
    !entry?.keptStatus
  );
}

async function waitForUsableNavigation(
  sessionId: string,
  tabId: number,
  requestedUrl: string
): Promise<void> {
  const startedAt = Date.now();
  let sawCommittedUrl = false;

  while (Date.now() - startedAt < NAVIGATION_TIMEOUT_MS) {
    const tab = await getTabIfExists(tabId);
    if (!tab) {
      purgeTrackedTab(tabId);
      throw new Error(`Tab ${tabId} is missing before navigation became usable.`);
    }

    const state = await probeTabState(sessionId, tabId);
    if (isCommittedNavigation(state, requestedUrl)) {
      sawCommittedUrl = true;
    }

    if (sawCommittedUrl && isUsableNavigationState(state, requestedUrl)) {
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

async function cleanupStaleTemporaryTabs(): Promise<void> {
  const staleEntries = registry.values().filter((entry) => entry.createdByUmb && !entry.sessionId);
  for (const entry of staleEntries) {
    await detachDebuggerNow(entry.tabId);
    const liveTab = await getTabIfExists(entry.tabId);
    if (liveTab) {
      await chrome.tabs.remove(entry.tabId).catch(() => undefined);
    }
    registry.delete(entry.tabId);
  }

  if (staleEntries.length > 0) {
    syncSessionStatus();
  }
}

async function cleanupStaleUmbGroupResidue(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id == null) {
      continue;
    }

    const tabGroup = await getTabGroupTitle(tab.groupId);
    if (!isUmbResidueTab(tab, tabGroup)) {
      continue;
    }

    await detachDebuggerNow(tab.id);
    await chrome.tabs.remove(tab.id).catch(() => undefined);
    registry.delete(tab.id);
    removeTabFromSessions(tab.id);
  }

  syncSessionStatus();
}

async function cleanupDanglingSessionEntries(): Promise<void> {
  const danglingEntries = registry.values().filter(
    (entry) => entry.sessionId && !sessions.has(entry.sessionId)
  );

  for (const entry of danglingEntries) {
    await detachDebuggerNow(entry.tabId);
    removeTabFromSessions(entry.tabId);

    if (entry.createdByUmb && !entry.keptStatus) {
      const liveTab = await getTabIfExists(entry.tabId);
      if (liveTab) {
        await chrome.tabs.remove(entry.tabId).catch(() => undefined);
      }
      registry.delete(entry.tabId);
      continue;
    }

    registry.markDetached(entry.tabId);
  }

  if (danglingEntries.length > 0) {
    syncSessionStatus();
  }
}

async function startSession(sessionId: string, clientId: string, name?: string) {
  await cleanupDanglingSessionEntries();
  await cleanupStaleTemporaryTabs();
  await cleanupStaleUmbGroupResidue();

  const existing = sessions.get(sessionId);
  if (existing) {
    existing.name = name ?? existing.name;
    activeSessionId = sessionId;
    syncSessionStatus();
    return getStatusResponse();
  }

  sessions.set(sessionId, {
    clientId,
    name,
    sessionId,
    tabIds: new Set<number>()
  });
  activeSessionId = sessionId;
  syncSessionStatus();
  return getStatusResponse();
}

async function openTabs() {
  await cleanupStaleTemporaryTabs();
  await cleanupStaleUmbGroupResidue();
  const tabs = await chrome.tabs.query({});
  const eligibleTabs = tabs.filter((tab) => tab.id != null);
  return Promise.all(eligibleTabs.map((tab) => simplifyTab(tab)));
}

async function getActiveTabInWindow(windowId: number): Promise<chrome.tabs.Tab | undefined> {
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  return activeTab;
}

async function claimTab(sessionId: string, tabId: number) {
  getSessionOrThrow(sessionId);
  const tab = await getTabIfExists(tabId);
  if (!tab) {
    purgeTrackedTab(tabId);
    throw new Error(`No tab with id: ${tabId}.`);
  }

  try {
    await attachDebugger(tabId, "background");
  } catch (backgroundError) {
    const previousActiveTab = tab.windowId != null
      ? await getActiveTabInWindow(tab.windowId)
      : undefined;

    try {
      await chrome.tabs.update(tabId, { active: true });
      await attachDebugger(tabId, "foreground");
    } catch (foregroundError) {
      await forceDetachDebugger(tabId);
      const backgroundMessage = backgroundError instanceof Error ? backgroundError.message : String(backgroundError);
      const foregroundMessage = foregroundError instanceof Error ? foregroundError.message : String(foregroundError);
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
  registry.markClaimed(tabId, sessionId);
  return simplifyTab((await getTabIfExists(tabId)) ?? tab);
}

async function newTab(sessionId: string) {
  getSessionOrThrow(sessionId);
  await cleanupStaleTemporaryTabs();

  // Comet refuses debugger attach on chrome://newtab/, so create an attachable page.
  const createdTab = await chrome.tabs.create({ active: false, url: "about:blank" });
  if (createdTab.id == null || createdTab.windowId == null) {
    throw new Error("Chrome did not return a tab id.");
  }

  const tabGroup = await addTabToUmbGroup(createdTab.id, createdTab.windowId);
  const canonicalTab = await getTabIfExists(createdTab.id);
  if (!canonicalTab?.id) {
    purgeTrackedTab(createdTab.id);
    throw new Error(`New UMB tab ${createdTab.id} disappeared before it became stable.`);
  }

  recordTabForSession(sessionId, canonicalTab.id);
  registry.markCreated(canonicalTab.id, sessionId, tabGroup);
  try {
    await attachDebugger(canonicalTab.id);
  } catch (error) {
    getSessionOrThrow(sessionId).tabIds.delete(canonicalTab.id);
    registry.delete(canonicalTab.id);
    throw error;
  }
  return simplifyTab(canonicalTab);
}

async function goto(sessionId: string, tabId: number, url: string) {
  await ensureControlledTab(sessionId, tabId);
  const result = await runDebuggerCommand<{ errorText?: string }>(
    tabId,
    "Page.navigate",
    { url },
    "navigate"
  );
  if (result?.errorText) {
    throw new Error(`Browser blocked navigation to ${url} on tab ${tabId}: ${result.errorText}`);
  }
  await waitForUsableNavigation(sessionId, tabId, url);
}

async function getUrl(sessionId: string, tabId: number) {
  await ensureControlledTab(sessionId, tabId);
  const tab = await getTabIfExists(tabId);
  if (!tab) {
    purgeTrackedTab(tabId);
    throw new Error(`No tab with id: ${tabId}.`);
  }
  return tab.url;
}

async function getTitle(sessionId: string, tabId: number) {
  await ensureControlledTab(sessionId, tabId);
  const tab = await getTabIfExists(tabId);
  if (!tab) {
    purgeTrackedTab(tabId);
    throw new Error(`No tab with id: ${tabId}.`);
  }
  return tab.title;
}

async function domSnapshot(sessionId: string, tabId: number) {
  return evaluateOnControlledTab(
    sessionId,
    tabId,
    `(() => ({
      url: location.href,
      title: document.title,
      documentHtml: document.documentElement?.outerHTML ?? "",
      text: document.body?.innerText ?? ""
    }))()`
  );
}

async function click(sessionId: string, tabId: number, selector: string) {
  return evaluateOnControlledTab(
    sessionId,
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Selector not found");
      if (!(el instanceof HTMLElement)) throw new Error("Target is not clickable");
      el.click();
      return true;
    })()`
  );
}

async function fill(sessionId: string, tabId: number, selector: string, value: string) {
  return evaluateOnControlledTab(
    sessionId,
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Selector not found");
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        throw new Error("Target is not fillable");
      }
      el.focus();
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`
  );
}

async function scroll(sessionId: string, tabId: number, x: number, y: number) {
  return evaluateOnControlledTab(
    sessionId,
    tabId,
    `(() => {
      window.scrollBy(${JSON.stringify(x)}, ${JSON.stringify(y)});
      return { x: window.scrollX, y: window.scrollY };
    })()`
  );
}

async function screenshot(sessionId: string, tabId: number) {
  await ensureControlledTab(sessionId, tabId);
  const result = await runDebuggerCommand<{ data: string }>(
    tabId,
    "Page.captureScreenshot",
    { format: "png" },
    "screenshot"
  );

  return `data:image/png;base64,${result.data}`;
}

async function nameSession(sessionId: string, name: string) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown UMB session ${sessionId}.`);
  }

  session.name = name;
  activeSessionId = sessionId;
  syncSessionStatus();
  return getStatusResponse();
}

async function verifyDetachedTabs(tabIds: Iterable<number>): Promise<number[]> {
  const ids = [...new Set([...tabIds])];

  for (let attempt = 0; attempt < DETACH_VERIFY_ATTEMPTS; attempt += 1) {
    await refreshAttachedTabsFromBrowser();
    const stillAttached = ids.filter((tabId) => attachedTabs.has(tabId));
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
  return ids.filter((tabId) => attachedTabs.has(tabId));
}

async function finalize(
  sessionId: string,
  keep: Array<{ id: string; status: "deliverable" | "handoff" }>,
  ownedTabIds: string[]
) {
  const session = sessions.get(sessionId);
  if (!session) {
    return { kept: keep, closed: [], released: [] };
  }

  const keepIds = new Set(keep.map((entry) => tabIdFromString(entry.id)));
  const registryTabIds = registry.valuesForSession(sessionId).map((entry) => entry.tabId);
  const attachedTabIds = filterAttachedTabIdsForSession({
    attachedTabIds: attachedTabs,
    sessionTabIds: session.tabIds,
    registryTabIds
  });
  const trackedIds = collectFinalizeTabIds({
    ownedTabIds,
    sessionTabIds: session.tabIds,
    registryTabIds,
    attachedTabIds
  });
  const closed: string[] = [];
  const released: string[] = [];

  for (const entry of keep) {
    registry.markKeep(tabIdFromString(entry.id), entry.status);
  }

  for (const trackedId of trackedIds) {
    const entry = registry.get(trackedId) ?? {
      tabId: trackedId,
      createdByUmb: false,
      claimed: true
    };

    await forceDetachDebugger(entry.tabId);
    session.tabIds.delete(entry.tabId);
    const liveTab = await getTabIfExists(entry.tabId);

    if (keepIds.has(entry.tabId)) {
      registry.markDetached(entry.tabId);
      continue;
    }

    if (entry.createdByUmb) {
      if (liveTab) {
        await chrome.tabs.remove(entry.tabId).catch(() => undefined);
      }
      closed.push(String(entry.tabId));
      registry.delete(entry.tabId);
      continue;
    }

    if (!liveTab) {
      registry.delete(entry.tabId);
      continue;
    }

    registry.markDetached(entry.tabId);
    released.push(String(entry.tabId));
  }

  const stillAttached = await verifyDetachedTabs(trackedIds);
  if (stillAttached.length > 0) {
    const reasonDetails = stillAttached
      .map((tabId) => `${tabId}${lastDetachReasons.get(tabId) ? `:${lastDetachReasons.get(tabId)}` : ""}`)
      .join(", ");
    updateStatus({
      lastError: `UMB завершил сессию, но браузер все еще держал attach для вкладок: ${reasonDetails}.`
    });
  }

  sessions.delete(sessionId);
  if (activeSessionId === sessionId) {
    activeSessionId = [...sessions.keys()].at(-1);
  }
  await cleanupStaleTemporaryTabs();
  await cleanupStaleUmbGroupResidue();
  syncSessionStatus();

  return { kept: keep, closed, released };
}

async function handleRequest(message: ExtensionRequest): Promise<unknown> {
  switch (message.type) {
    case "startSession":
      return startSession(
        message.payload.sessionId,
        message.payload.clientId,
        message.payload.name
      );
    case "getStatus":
      syncSessionStatus();
      return getStatusResponse();
    case "openTabs":
      return openTabs();
    case "claimTab":
      return claimTab(message.payload.sessionId, tabIdFromString(message.payload.tabId));
    case "newTab":
      return newTab(message.payload.sessionId);
    case "goto":
      return goto(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId),
        message.payload.url
      );
    case "getUrl":
      return getUrl(message.payload.sessionId, tabIdFromString(message.payload.tabId));
    case "getTitle":
      return getTitle(message.payload.sessionId, tabIdFromString(message.payload.tabId));
    case "domSnapshot":
      return domSnapshot(message.payload.sessionId, tabIdFromString(message.payload.tabId));
    case "click":
      return click(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId),
        message.payload.selector
      );
    case "fill":
      return fill(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId),
        message.payload.selector,
        message.payload.value
      );
    case "scroll":
      return scroll(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId),
        message.payload.x,
        message.payload.y
      );
    case "screenshot":
      return screenshot(message.payload.sessionId, tabIdFromString(message.payload.tabId));
    case "nameSession":
      return nameSession(message.payload.sessionId, message.payload.name);
    case "finalize":
      return finalize(message.payload.sessionId, message.payload.keep, message.payload.ownedTabIds);
  }
}

async function sendResponse(response: ExtensionResponse) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(response));
}

function sendHello() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify({
      id: "hello",
      ok: true,
      result: getStatusResponse()
    } satisfies ExtensionResponse)
  );
}

function scheduleSocketReconnect(delay = SOCKET_RECONNECT_DELAY_MS) {
  if (socketReconnectTimer != null) {
    return;
  }

  socketReconnectTimer = setTimeout(() => {
    socketReconnectTimer = undefined;
    connectToDaemon(socketUrl);
  }, delay) as unknown as number;
}

async function cleanupSessionsAfterDisconnect() {
  const tabsToVerify = new Set<number>();
  for (const sessionId of [...sessions.keys()]) {
    const session = sessions.get(sessionId);
    if (!session) {
      continue;
    }

    for (const tabId of [...session.tabIds]) {
      tabsToVerify.add(tabId);
      await forceDetachDebugger(tabId);
      registry.markDetached(tabId);
    }
  }

  for (const tabId of attachedTabs) {
    tabsToVerify.add(tabId);
  }

  sessions.clear();
  activeSessionId = undefined;
  await verifyDetachedTabs(tabsToVerify);
  await cleanupStaleTemporaryTabs();
  await cleanupStaleUmbGroupResidue();
  syncSessionStatus();
}

function scheduleSessionCleanup() {
  clearSessionCleanupTimer();
  sessionCleanupTimer = setTimeout(() => {
    sessionCleanupTimer = undefined;
    void cleanupSessionsAfterDisconnect();
  }, SESSION_CLEANUP_DELAY_MS) as unknown as number;
}

function deriveHealthUrl(nextSocketUrl: string): string | undefined {
  if (uiStatus.daemonHttpUrl) {
    return `${uiStatus.daemonHttpUrl.replace(/\/$/, "")}/health`;
  }

  try {
    const ws = new URL(nextSocketUrl);
    const httpProtocol = ws.protocol === "wss:" ? "https:" : "http:";
    return `${httpProtocol}//${ws.host}/health`;
  } catch {
    return undefined;
  }
}

async function refreshDaemonStatus(nextSocketUrl: string): Promise<boolean> {
  const healthUrl = deriveHealthUrl(nextSocketUrl);
  if (!healthUrl) {
    return true;
  }

  try {
    const response = await fetch(healthUrl, { method: "GET", cache: "no-store" });
    if (!response.ok) {
      return false;
    }

    const health = (await response.json().catch(() => ({}))) as DaemonHealthResponse;
    updateStatus({
      daemonHttpUrl: healthUrl.replace(/\/health$/, ""),
      daemonPid: health.daemon?.pid,
      daemonStartedAt: health.daemon?.startedAt
    });
    syncSessionStatus();
    return true;
  } catch {
    return false;
  }
}

async function connectToDaemon(nextSocketUrl: string) {
  socketUrl = nextSocketUrl;
  updateStatus({ wsUrl: socketUrl });
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const daemonReachable = await refreshDaemonStatus(socketUrl);
  if (!daemonReachable) {
    updateStatus({
      connected: false,
      lastError: "Локальный мост UMB пока недоступен. Расширение повторит подключение автоматически."
    });
    scheduleSessionCleanup();
    scheduleSocketReconnect();
    return;
  }

  const currentSocket = new WebSocket(socketUrl);
  socket = currentSocket;

  currentSocket.addEventListener("open", () => {
    if (socket !== currentSocket) {
      return;
    }

    clearSessionCleanupTimer();
    updateStatus({
      connected: true,
      lastConnectedAt: new Date().toISOString(),
      lastError: undefined
    });
    syncSessionStatus();
    sendHello();
  });

  currentSocket.addEventListener("message", async (event) => {
    const request = JSON.parse(String(event.data)) as ExtensionRequest;
    try {
      const result = await handleRequest(request);
      await sendResponse({ id: request.id, ok: true, result });
    } catch (error) {
      await sendResponse({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  currentSocket.addEventListener("close", (event) => {
    if (socket === currentSocket) {
      socket = undefined;
    }
    updateStatus({
      connected: false,
      lastError: event.wasClean
        ? undefined
        : `Соединение с мостом неожиданно закрылось (${event.code}).`
    });
    scheduleSessionCleanup();
    scheduleSocketReconnect();
  });

  currentSocket.addEventListener("error", () => {
    updateStatus({
      connected: false,
      lastError: "Соединение расширения с мостом прервалось. Повторяю подключение."
    });
    currentSocket.close();
  });
}

function scheduleNativeReconnect(delay = NATIVE_RECONNECT_DELAY_MS) {
  if (nativeReconnectTimer != null) {
    return;
  }

  nativeReconnectTimer = setTimeout(() => {
    nativeReconnectTimer = undefined;
    connectToNativeHost();
  }, delay) as unknown as number;
}

function applyBootstrapStatus(nativeInfo: BootstrapStatus) {
  updateStatus({
    daemonHttpUrl: nativeInfo.daemonHttpUrl,
    daemonPid: nativeInfo.daemonPid,
    daemonStartedAt: nativeInfo.daemonStartedAt,
    hostName: nativeInfo.hostName,
    nativeHostPid: nativeInfo.nativeHostPid,
    wsUrl: nativeInfo.wsUrl
  });
  syncSessionStatus();
}

function connectToNativeHost() {
  if (nativePort) {
    return;
  }

  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    nativePort = port;
    updateStatus({
      hostName: NATIVE_HOST_NAME,
      lastError: undefined
    });

    port.onMessage.addListener((message) => {
      if (nativePort !== port) {
        return;
      }

      applyBootstrapStatus(message as BootstrapStatus);
      connectToDaemon((message as BootstrapStatus).wsUrl ?? DAEMON_URL);
    });

    port.onDisconnect.addListener(() => {
      if (nativePort !== port) {
        return;
      }

      nativePort = undefined;
      const error = chrome.runtime.lastError;
      updateStatus({
        nativeHostPid: undefined,
        lastError: error?.message ?? "Нативный хост UMB отключился."
      });
      scheduleNativeReconnect();
      connectToDaemon(socketUrl);
    });

    port.postMessage({ type: "getDaemonInfo" });
  } catch (error) {
    updateStatus({
      lastError: error instanceof Error ? error.message : String(error)
    });
    console.warn("UMB native host bootstrap failed, falling back to default daemon URL.", error);
    connectToDaemon(DAEMON_URL);
    scheduleNativeReconnect();
  }
}

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!Number.isInteger(source.tabId)) {
    return;
  }

  const tabId = source.tabId as number;

  attachedTabs.delete(tabId);
  lastDetachReasons.set(tabId, reason);
  syncSessionStatus();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void detachDebuggerNow(tabId);
  purgeTrackedTab(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "umb:get-status") {
    return false;
  }

  sendResponse(getStatusSnapshot());
  return true;
});

updateBadge();
connectToNativeHost();
