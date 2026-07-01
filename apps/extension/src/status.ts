import { extensionState, type StatusResponse, type UiStatus } from "./bridge-state.js";

function updateBadge() {
  const text = extensionState.uiStatus.connected ? "ON" : "OFF";
  const color = extensionState.uiStatus.connected ? "#157347" : "#a61e4d";
  void chrome.action.setBadgeText({ text });
  void chrome.action.setBadgeBackgroundColor({ color });
}

export function updateStatus(next: Partial<UiStatus>) {
  Object.assign(extensionState.uiStatus, next);
  updateBadge();
}

export function syncSessionStatus() {
  const session = extensionState.activeSessionId
    ? extensionState.sessions.get(extensionState.activeSessionId)
    : undefined;
  updateStatus({
    activeDebuggerSessions: extensionState.attachedTabs.size,
    attachedTabCount: extensionState.attachedTabs.size,
    connectedProcessLabel: extensionState.uiStatus.daemonPid
      ? `daemon:${extensionState.uiStatus.daemonPid}`
      : undefined,
    sessionActive: Boolean(session),
    sessionId: session?.sessionId,
    sessionName: session?.name
  });
}

export function getStatusSnapshot(): UiStatus {
  return { ...extensionState.uiStatus };
}

export function getStatusResponse(): StatusResponse {
  return {
    attachedTabCount: extensionState.uiStatus.attachedTabCount,
    clientLabel: "UMB Chrome extension",
    connectedProcessLabel: extensionState.uiStatus.connectedProcessLabel,
    sessionActive: extensionState.uiStatus.sessionActive,
    sessionId: extensionState.uiStatus.sessionId,
    sessionName: extensionState.uiStatus.sessionName
  };
}
