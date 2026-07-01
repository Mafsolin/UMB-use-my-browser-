import { TabRegistry, type TabRegistryEntry } from "./tab-registry.js";

export const DAEMON_URL = "ws://127.0.0.1:44777/extension";
export const DEBUGGER_VERSION = "1.3";
export const NATIVE_HOST_NAME = "com.umb.use_my_browser";
export const SOCKET_RECONNECT_DELAY_MS = 1_500;
export const NATIVE_RECONNECT_DELAY_MS = 1_500;
export const SESSION_CLEANUP_DELAY_MS = 5_000;
export const DEBUGGER_STAGE_TIMEOUT_MS = 5_000;
export const DEBUGGER_DETACH_TIMEOUT_MS = 1_500;
export const DETACH_VERIFY_ATTEMPTS = 3;
export const DETACH_VERIFY_DELAY_MS = 250;
export const NAVIGATION_TIMEOUT_MS = 15_000;
export const NAVIGATION_POLL_MS = 250;
export const TAB_GROUP_TITLE = "UMB";

export type SessionState = {
  clientId: string;
  name?: string;
  sessionId: string;
  tabIds: Set<number>;
};

export type StatusResponse = {
  attachedTabCount?: number;
  clientLabel: string;
  connectedProcessLabel?: string;
  sessionActive?: boolean;
  sessionId?: string;
  sessionName?: string;
};

export type DaemonHealthResponse = {
  daemon?: {
    pid?: number;
    startedAt?: string;
  };
};

export type BootstrapStatus = {
  bearerToken?: string;
  allowedOrigins?: string[];
  daemonHttpUrl?: string;
  daemonPid?: number;
  daemonStartedAt?: string;
  hostName?: string;
  nativeHostPid?: number;
  wsUrl?: string;
};

export type UiStatus = BootstrapStatus & {
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

export type SimplifiedTab = {
  id: string;
  title?: string;
  url?: string;
  active?: boolean;
  kind?: string;
  tabGroup?: string;
};

export const extensionState = {
  registry: new TabRegistry(),
  sessions: new Map<string, SessionState>(),
  activeSessionId: undefined as string | undefined,
  attachedTabs: new Set<number>(),
  lastDetachReasons: new Map<number, string>(),
  bridgeBearerToken: undefined as string | undefined,
  bridgeAllowedOrigins: undefined as string[] | undefined,
  extensionStartedAt: new Date().toISOString(),
  socket: undefined as WebSocket | undefined,
  socketUrl: DAEMON_URL,
  socketReconnectTimer: undefined as number | undefined,
  sessionCleanupTimer: undefined as number | undefined,
  nativePort: undefined as chrome.runtime.Port | undefined,
  nativeReconnectTimer: undefined as number | undefined,
  uiStatus: {
    activeDebuggerSessions: 0,
    attachedTabCount: 0,
    connected: false,
    extensionStartedAt: new Date().toISOString(),
    sessionActive: false
  } as UiStatus
};

export function getSessionEntry(tabId: number): TabRegistryEntry | undefined {
  return extensionState.registry.get(tabId);
}
