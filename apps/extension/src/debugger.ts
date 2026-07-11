import {
  DEBUGGER_DETACH_TIMEOUT_MS,
  DEBUGGER_STAGE_TIMEOUT_MS,
  DEBUGGER_VERSION,
  extensionState
} from "./bridge-state.js";
import { syncSessionStatus } from "./status.js";
import { getTabIfExists } from "./tabs.js";

export type DebuggerStage =
  | "attach"
  | "runtime-enable"
  | "page-enable"
  | "navigate"
  | "evaluate"
  | "screenshot"
  | "detach";

export type DebuggerAttachMode = "background" | "foreground";

export async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = DEBUGGER_STAGE_TIMEOUT_MS
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout != null) {
      clearTimeout(timeout);
    }
  }
}

export async function refreshAttachedTabsFromBrowser(): Promise<void> {
  try {
    const targets = await chrome.debugger.getTargets();
    extensionState.attachedTabs.clear();
    for (const target of targets) {
      if (target.attached && Number.isInteger(target.tabId)) {
        extensionState.attachedTabs.add(target.tabId as number);
      }
    }
  } catch {
    // Ignore target introspection failures and keep local runtime state.
  } finally {
    syncSessionStatus();
  }
}

export async function runDebuggerCommand<T>(
  tabId: number,
  method: string,
  commandParams: Record<string, unknown> | undefined,
  stage: DebuggerStage,
  timeoutMs = DEBUGGER_STAGE_TIMEOUT_MS
): Promise<T> {
  return await withTimeout(
    chrome.debugger.sendCommand({ tabId }, method, commandParams) as unknown as Promise<T>,
    `Debugger ${stage} for tab ${tabId}`,
    timeoutMs
  );
}

export function describeDebuggerError(
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

export async function attachDebugger(
  tabId: number,
  mode: DebuggerAttachMode = "background"
): Promise<void> {
  await refreshAttachedTabsFromBrowser();
  if (extensionState.attachedTabs.has(tabId)) {
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
    extensionState.attachedTabs.add(tabId);
    extensionState.lastDetachReasons.delete(tabId);
    await refreshAttachedTabsFromBrowser();
  } catch (error) {
    await forceDetachDebugger(tabId);
    throw new Error(
      `Debugger attach failed for tab ${tabId} (${mode}): ${describeDebuggerError(tabId, "page-enable", error).message}`
    );
  }
}

export async function forceDetachDebugger(tabId: number): Promise<void> {
  try {
    await withTimeout(
      chrome.debugger.detach({ tabId }),
      `Debugger detach for tab ${tabId}`,
      DEBUGGER_DETACH_TIMEOUT_MS
    );
  } catch {
    // Ignore detach races and already-detached states.
  } finally {
    extensionState.attachedTabs.delete(tabId);
    await refreshAttachedTabsFromBrowser();
  }
}

export async function detachDebuggerNow(tabId: number): Promise<void> {
  if (!extensionState.attachedTabs.has(tabId)) {
    await refreshAttachedTabsFromBrowser();
    if (!extensionState.attachedTabs.has(tabId)) {
      return;
    }
  }

  await forceDetachDebugger(tabId);
}

export async function ensureControlledTab(sessionId: string, tabId: number): Promise<void> {
  const session = extensionState.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown UMB session ${sessionId}.`);
  }
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

function purgeTrackedTab(tabId: number) {
  extensionState.attachedTabs.delete(tabId);
  for (const session of extensionState.sessions.values()) {
    session.tabIds.delete(tabId);
  }
  extensionState.registry.delete(tabId);
  syncSessionStatus();
}

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!Number.isInteger(source.tabId)) {
    return;
  }

  const tabId = source.tabId as number;
  extensionState.attachedTabs.delete(tabId);
  extensionState.lastDetachReasons.set(tabId, reason);
  syncSessionStatus();
});
