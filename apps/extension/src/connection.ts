import {
  DAEMON_URL,
  extensionState,
  NATIVE_HOST_NAME,
  NATIVE_RECONNECT_DELAY_MS,
  SESSION_CLEANUP_DELAY_MS,
  SOCKET_RECONNECT_DELAY_MS,
  type BootstrapStatus,
  type DaemonHealthResponse
} from "./bridge-state.js";
import { buildBridgeSubprotocols, hasBridgeBearerToken } from "./bridge-auth.js";
import { handleRequest } from "./commands.js";
import { getStatusResponse, syncSessionStatus, updateStatus } from "./status.js";
import type { ExtensionResponse } from "./messages.js";
import { verifyDetachedTabs } from "./permissions.js";
import {
  cleanupStaleTemporaryTabs,
  cleanupStaleUmbGroupResidue
} from "./tabs.js";
import { forceDetachDebugger } from "./debugger.js";

export function sendResponse(response: ExtensionResponse) {
  if (!extensionState.socket || extensionState.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  extensionState.socket.send(JSON.stringify(response));
}

export function sendHello() {
  if (!extensionState.socket || extensionState.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  extensionState.socket.send(
    JSON.stringify({
      id: "hello",
      ok: true,
      result: getStatusResponse()
    } satisfies ExtensionResponse)
  );
}

export function scheduleSocketReconnect(delay = SOCKET_RECONNECT_DELAY_MS) {
  if (extensionState.socketReconnectTimer != null) {
    return;
  }
  extensionState.socketReconnectTimer = setTimeout(() => {
    extensionState.socketReconnectTimer = undefined;
    void connectToDaemon(extensionState.socketUrl);
  }, delay) as unknown as number;
}

export async function cleanupSessionsAfterDisconnect(): Promise<void> {
  const tabsToVerify = new Set<number>();
  for (const sessionId of [...extensionState.sessions.keys()]) {
    const session = extensionState.sessions.get(sessionId);
    if (!session) {
      continue;
    }
    for (const tabId of [...session.tabIds]) {
      tabsToVerify.add(tabId);
      await forceDetachDebugger(tabId);
      extensionState.registry.markDetached(tabId);
    }
  }
  for (const tabId of extensionState.attachedTabs) {
    tabsToVerify.add(tabId);
  }
  extensionState.sessions.clear();
  extensionState.activeSessionId = undefined;
  await verifyDetachedTabs(tabsToVerify);
  await cleanupStaleTemporaryTabs();
  await cleanupStaleUmbGroupResidue();
  syncSessionStatus();
}

function clearSessionCleanupTimer() {
  if (extensionState.sessionCleanupTimer == null) {
    return;
  }
  clearTimeout(extensionState.sessionCleanupTimer);
  extensionState.sessionCleanupTimer = undefined;
}

export function scheduleSessionCleanup() {
  clearSessionCleanupTimer();
  extensionState.sessionCleanupTimer = setTimeout(() => {
    extensionState.sessionCleanupTimer = undefined;
    void cleanupSessionsAfterDisconnect();
  }, SESSION_CLEANUP_DELAY_MS) as unknown as number;
}

function deriveHealthUrl(nextSocketUrl: string): string | undefined {
  if (extensionState.uiStatus.daemonHttpUrl) {
    return `${extensionState.uiStatus.daemonHttpUrl.replace(/\/$/, "")}/health`;
  }
  try {
    const ws = new URL(nextSocketUrl);
    const httpProtocol = ws.protocol === "wss:" ? "https:" : "http:";
    return `${httpProtocol}//${ws.host}/health`;
  } catch {
    return undefined;
  }
}

export async function refreshDaemonStatus(nextSocketUrl: string): Promise<boolean> {
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

export async function connectToDaemon(nextSocketUrl: string) {
  extensionState.socketUrl = nextSocketUrl;
  updateStatus({ wsUrl: extensionState.socketUrl });
  if (
    extensionState.socket &&
    (extensionState.socket.readyState === WebSocket.OPEN ||
      extensionState.socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const daemonReachable = await refreshDaemonStatus(extensionState.socketUrl);
  if (!daemonReachable) {
    updateStatus({
      connected: false,
      lastError: "Локальный мост UMB пока недоступен. Расширение повторит подключение автоматически."
    });
    scheduleSessionCleanup();
    scheduleSocketReconnect();
    return;
  }

  if (!hasBridgeBearerToken(extensionState.bridgeBearerToken)) {
    updateStatus({
      connected: false,
      lastError:
        "UMB ждет токен аутентификации от native host перед подключением к локальному мосту."
    });
    scheduleSocketReconnect();
    return;
  }

  const currentSocket = new WebSocket(
    extensionState.socketUrl,
    buildBridgeSubprotocols(extensionState.bridgeBearerToken)
  );
  extensionState.socket = currentSocket;

  currentSocket.addEventListener("open", () => {
    if (extensionState.socket !== currentSocket) {
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
    const request = JSON.parse(String(event.data)) as Parameters<typeof handleRequest>[0];
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
    if (extensionState.socket === currentSocket) {
      extensionState.socket = undefined;
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

export function scheduleNativeReconnect(delay = NATIVE_RECONNECT_DELAY_MS) {
  if (extensionState.nativeReconnectTimer != null) {
    return;
  }
  extensionState.nativeReconnectTimer = setTimeout(() => {
    extensionState.nativeReconnectTimer = undefined;
    void connectToNativeHost();
  }, delay) as unknown as number;
}

export function applyBootstrapStatus(nativeInfo: BootstrapStatus) {
  extensionState.bridgeBearerToken = nativeInfo.bearerToken;
  extensionState.bridgeAllowedOrigins = nativeInfo.allowedOrigins;
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

export function connectToNativeHost() {
  if (extensionState.nativePort) {
    return;
  }
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    extensionState.nativePort = port;
    updateStatus({
      hostName: NATIVE_HOST_NAME,
      lastError: undefined
    });

    port.onMessage.addListener((message) => {
      if (extensionState.nativePort !== port) {
        return;
      }
      applyBootstrapStatus(message as BootstrapStatus);
      void connectToDaemon((message as BootstrapStatus).wsUrl ?? DAEMON_URL);
    });

    port.onDisconnect.addListener(() => {
      if (extensionState.nativePort !== port) {
        return;
      }
      extensionState.nativePort = undefined;
      const error = chrome.runtime.lastError;
      updateStatus({
        nativeHostPid: undefined,
        lastError: error?.message ?? "Нативный хост UMB отключился."
      });
      scheduleNativeReconnect();
      void connectToDaemon(extensionState.socketUrl);
    });

    port.postMessage({ type: "getDaemonInfo", extensionId: chrome.runtime.id });
  } catch (error) {
    updateStatus({
      lastError: error instanceof Error ? error.message : String(error)
    });
    console.warn(
      "UMB native host bootstrap failed, falling back to default daemon URL.",
      error
    );
    void connectToDaemon(DAEMON_URL);
    scheduleNativeReconnect();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "umb:get-status") {
    return false;
  }
  sendResponse({ ...extensionState.uiStatus });
  return true;
});
