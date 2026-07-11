import { WebSocketServer, type WebSocket } from "ws";
import type {
  BrowserConnector,
  BridgeTab,
  DomSnapshotResult,
  FindControlsOptions,
  FindControlsResult,
  FinalizeRequest,
  ReadPageResult,
  ScrollResult
} from "@umb/core";

type PendingEntry = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type BridgeRequest = {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
};

type BridgeResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type BridgeAuthConfig = {
  bearerToken: string;
  allowedOrigins: string[];
};

export type BridgeHandshakeResult =
  | { ok: true; protocol: string }
  | { ok: false; reason: string };

const BEARER_PROTOCOL_PREFIX = "bearer.";
const DEFAULT_PROTOCOL = "umb-v1";

export function verifyBridgeHandshake(input: {
  origin: string | undefined;
  protocols: Iterable<string> | string;
  expectedToken: string;
  allowedOrigins: string[];
}): BridgeHandshakeResult {
  const protocolList =
    typeof input.protocols === "string" ? [input.protocols] : [...input.protocols];

  const bearerProtocol = protocolList.find(
    (entry) => typeof entry === "string" && entry.startsWith(BEARER_PROTOCOL_PREFIX)
  );
  if (!bearerProtocol) {
    return { ok: false, reason: "Missing bearer token in WebSocket subprotocols." };
  }

  const providedToken = bearerProtocol.slice(BEARER_PROTOCOL_PREFIX.length);
  if (!providedToken || providedToken !== input.expectedToken) {
    return { ok: false, reason: "Invalid bearer token in WebSocket subprotocols." };
  }

  if (!input.origin) {
    return { ok: false, reason: "Missing Origin header on WebSocket upgrade." };
  }

  const originAllowed = input.allowedOrigins.some((pattern) =>
    matchesOriginPattern(input.origin!, pattern)
  );
  if (!originAllowed) {
    return {
      ok: false,
      reason: `Origin ${input.origin} is not in the UMB bridge allowlist.`
    };
  }

  const chosenProtocol =
    protocolList.find(
      (entry) => typeof entry === "string" && !entry.startsWith(BEARER_PROTOCOL_PREFIX)
    ) ?? DEFAULT_PROTOCOL;
  return { ok: true, protocol: chosenProtocol };
}

function matchesOriginPattern(origin: string, pattern: string): boolean {
  if (pattern === origin) {
    return true;
  }
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return origin.startsWith(prefix);
  }
  return false;
}

export class ExtensionConnector implements BrowserConnector {
  readonly capabilities = {
    canReadBackgroundTab: true,
    canInteractBackgroundTab: true,
    requiresForegroundForInput: false
  };

  private socket?: WebSocket;
  private readonly pending = new Map<string, PendingEntry>();
  private lastConnectedAt?: string;
  private clientLabel?: string;
  private currentSessionId?: string;
  private sessionStatus?: {
    sessionId?: string;
    sessionName?: string;
    attachedTabCount?: number;
    sessionActive?: boolean;
    connectedProcessLabel?: string;
  };
  private readonly requestTimeoutMs: number;
  private readonly auth: BridgeAuthConfig;

  constructor(auth: BridgeAuthConfig, requestTimeoutMs = 30000) {
    this.auth = auth;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  getAuthConfig(): { allowedOrigins: string[] } {
    return { allowedOrigins: [...this.auth.allowedOrigins] };
  }

  getConnectionStatus() {
    return {
      connected: Boolean(this.socket && this.socket.readyState === this.socket.OPEN),
      lastConnectedAt: this.lastConnectedAt,
      clientLabel: this.clientLabel,
      sessionActive: this.sessionStatus?.sessionActive,
      sessionId: this.sessionStatus?.sessionId,
      sessionName: this.sessionStatus?.sessionName,
      attachedTabCount: this.sessionStatus?.attachedTabCount,
      connectedProcessLabel: this.sessionStatus?.connectedProcessLabel
    };
  }

  async getLiveConnectionStatus() {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      return this.getConnectionStatus();
    }

    await this.send("getStatus");
    return this.getConnectionStatus();
  }

  async beginSession(session: {
    sessionId: string;
    clientId: string;
    name?: string;
  }): Promise<void> {
    this.currentSessionId = session.sessionId;
    await this.send("startSession", session);
  }

  async updateSession(session: {
    sessionId: string;
    name?: string;
  }): Promise<void> {
    this.currentSessionId = session.sessionId;
    if (session.name) {
      await this.send("nameSession", {
        sessionId: session.sessionId,
        name: session.name
      });
    }
  }

  async endSession(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    try {
      await this.send("finalize", { sessionId, ownedTabIds: [], keep: [] });
      if (this.currentSessionId === sessionId) {
        this.currentSessionId = undefined;
      }
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("extension is not connected")) {
        throw error;
      }
    }
  }

  attachToServer(server: import("node:http").Server, path = "/extension"): WebSocketServer {
    const wsServer = new WebSocketServer({
      server,
      path,
      handleProtocols: (protocols, request) => {
        const result = verifyBridgeHandshake({
          origin: request.headers.origin,
          protocols,
          expectedToken: this.auth.bearerToken,
          allowedOrigins: this.auth.allowedOrigins
        });
        if (!result.ok) {
          console.warn(`UMB bridge handshake rejected: ${result.reason}`);
          return false;
        }
        return result.protocol;
      }
    });
    wsServer.on("connection", (socket: WebSocket) => {
      this.failAllPending(new Error("UMB extension reconnected before pending requests completed."));
      this.socket = socket;
      this.lastConnectedAt = new Date().toISOString();
      socket.on("message", (raw: import("ws").RawData) => this.handleMessage(String(raw)));
      socket.on("close", () => {
        if (this.socket === socket) {
          this.socket = undefined;
        }
        this.sessionStatus = {
          sessionActive: false,
          sessionId: undefined,
          sessionName: undefined,
          attachedTabCount: 0,
          connectedProcessLabel: undefined
        };
        this.currentSessionId = undefined;
        this.failAllPending(new Error("UMB extension disconnected from the daemon."));
      });
    });
    return wsServer;
  }

  async openTabs(): Promise<BridgeTab[]> {
    return this.send("openTabs");
  }

  async claimTab(tabId: string): Promise<BridgeTab> {
    return this.send("claimTab", {
      sessionId: this.getCurrentSessionId(),
      tabId
    });
  }

  async newTab(url?: string): Promise<BridgeTab> {
    return this.send("newTab", {
      sessionId: this.getCurrentSessionId(),
      ...(url === undefined ? {} : { url })
    });
  }

  async goto(tabId: string, url: string): Promise<void> {
    await this.send("goto", {
      sessionId: this.getCurrentSessionId(),
      tabId,
      url
    });
  }

  async getUrl(tabId: string): Promise<string | undefined> {
    return this.send("getUrl", {
      sessionId: this.getCurrentSessionId(),
      tabId
    });
  }

  async getTitle(tabId: string): Promise<string | undefined> {
    return this.send("getTitle", {
      sessionId: this.getCurrentSessionId(),
      tabId
    });
  }

  async readPage(
    tabId: string,
    options: { format: "markdown" | "text"; maxChars?: number; includeMetadata: boolean }
  ): Promise<ReadPageResult> {
    return this.send("readPage", {
      sessionId: this.getCurrentSessionId(),
      tabId,
      ...options
    });
  }

  async findControls(tabId: string, options: FindControlsOptions): Promise<FindControlsResult> {
    return this.send("findControls", {
      sessionId: this.getCurrentSessionId(),
      tabId,
      ...options
    });
  }

  async domSnapshot(tabId: string): Promise<DomSnapshotResult> {
    return this.send("domSnapshot", {
      sessionId: this.getCurrentSessionId(),
      tabId
    });
  }

  async click(tabId: string, selector: string): Promise<void> {
    await this.send("click", {
      sessionId: this.getCurrentSessionId(),
      tabId,
      selector
    });
  }

  async fill(tabId: string, selector: string, value: string): Promise<void> {
    await this.send("fill", {
      sessionId: this.getCurrentSessionId(),
      tabId,
      selector,
      value
    });
  }

  async submit(tabId: string, selector: string): Promise<{ confirmed: boolean }> {
    return this.send("submit", {
      sessionId: this.getCurrentSessionId(),
      tabId,
      selector
    });
  }

  async scroll(tabId: string, x: number, y: number): Promise<ScrollResult> {
    return await this.send("scroll", {
      sessionId: this.getCurrentSessionId(),
      tabId,
      x,
      y
    });
  }

  async screenshot(tabId: string): Promise<string> {
    return this.send("screenshot", {
      sessionId: this.getCurrentSessionId(),
      tabId
    });
  }

  async finalize(request: FinalizeRequest): Promise<{
    kept: FinalizeRequest["keep"];
    closed: string[];
    released: string[];
  }> {
    const result = await this.send<{
      kept: FinalizeRequest["keep"];
      closed: string[];
      released: string[];
    }>("finalize", request);
    await this.getLiveConnectionStatus();
    return result;
  }

  private getCurrentSessionId(): string {
    const sessionId = this.currentSessionId ?? this.sessionStatus?.sessionId;
    if (!sessionId) {
      throw new Error("UMB bridge is connected but no extension session is active.");
    }

    return sessionId;
  }

  private async send<T>(type: string, payload?: Record<string, unknown>): Promise<T> {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      throw new Error("UMB daemon is up but the extension is not connected.");
    }

    const id = crypto.randomUUID();
    const message: BridgeRequest = { id, type, payload };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`UMB bridge request timed out for command ${type}.`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (reason) => {
          clearTimeout(timeout);
          reject(reason);
        }
      });
      this.socket!.send(JSON.stringify(message), (error?: Error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  private handleMessage(raw: string): void {
    const parsed = JSON.parse(raw) as BridgeResponse;
    if (parsed.id === "hello" && parsed.ok) {
      this.captureStatus(parsed.result);
      return;
    }
    const entry = this.pending.get(parsed.id);
    if (!entry) {
      return;
    }

    this.pending.delete(parsed.id);
    if (!parsed.ok) {
      entry.reject(new Error(parsed.error ?? "Unknown extension bridge error"));
      return;
    }

    this.captureStatus(parsed.result);

    entry.resolve(parsed.result);
  }

  private captureStatus(result: unknown): void {
    if (typeof result !== "object" || !result) {
      return;
    }

    const candidate = result as {
      clientLabel?: string;
      sessionId?: string;
      sessionName?: string;
      attachedTabCount?: number;
      sessionActive?: boolean;
      connectedProcessLabel?: string;
    };

    if (candidate.clientLabel) {
      this.clientLabel = candidate.clientLabel;
    }

    if (
      "sessionActive" in candidate ||
      "sessionId" in candidate ||
      "sessionName" in candidate ||
      "attachedTabCount" in candidate ||
      "connectedProcessLabel" in candidate
    ) {
      this.sessionStatus = {
        sessionId: candidate.sessionId,
        sessionName: candidate.sessionName,
        attachedTabCount: candidate.attachedTabCount,
        sessionActive: candidate.sessionActive,
        connectedProcessLabel: candidate.connectedProcessLabel
      };
      this.currentSessionId =
        candidate.sessionActive === false ? undefined : candidate.sessionId ?? this.currentSessionId;
    }
  }

  private failAllPending(error: Error): void {
    for (const [id, entry] of this.pending.entries()) {
      this.pending.delete(id);
      entry.reject(error);
    }
  }
}
