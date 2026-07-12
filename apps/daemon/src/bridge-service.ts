import type {
  BridgeCommand,
  BridgePermissions,
  BridgeSession
} from "@umb/protocol";
import { FakeConnector, SessionManager, type BrowserConnector } from "@umb/core";
import { createCommandRouter } from "./command-router.js";
import { AuditLogger } from "./audit-log.js";
import { TabSessionRegistry } from "./tab-session-registry.js";

type CommandWithTabId = Extract<
  BridgeCommand,
  { params: { tabId: string } }
>;

function hasTabId(command: BridgeCommand): command is CommandWithTabId {
  return (
    command.type !== "openTabs" &&
    command.type !== "newTab" &&
    command.type !== "nameSession" &&
    command.type !== "finalize"
  );
}

export class BridgeService {
  private readonly sessionManager = new SessionManager();
  private readonly connector: BrowserConnector;
  private readonly router: ReturnType<typeof createCommandRouter>;
  private readonly auditLogger: AuditLogger;
  private readonly tabRegistry = new TabSessionRegistry();
  private activeSessionId?: string;
  private readonly finalizedSessionIds = new Set<string>();
  private commandQueue: Promise<void> = Promise.resolve();

  constructor(
    connector: BrowserConnector = new FakeConnector(),
    auditLogger = new AuditLogger()
  ) {
    this.connector = connector;
    this.router = createCommandRouter(this.connector);
    this.auditLogger = auditLogger;
  }

  createSession(input: {
    clientId: string;
    permissions: BridgePermissions;
  }): BridgeSession {
    const session = this.sessionManager.createSession(input);
    this.finalizedSessionIds.delete(session.sessionId);
    return session;
  }

  getSession(sessionId: string): BridgeSession {
    return this.sessionManager.getSession(sessionId);
  }

  async getConnectionStatus() {
    const connectorStatus = this.connector.getLiveConnectionStatus
      ? await this.connector.getLiveConnectionStatus()
      : (this.connector.getConnectionStatus?.() ?? { connected: true });

    if (connectorStatus.connected === false || connectorStatus.sessionActive === false) {
      this.activeSessionId = undefined;
      return {
        ...connectorStatus,
        sessionActive: connectorStatus.connected === false ? false : connectorStatus.sessionActive,
        sessionId: undefined,
        sessionName: undefined
      };
    }

    if (!this.activeSessionId || connectorStatus.sessionActive !== undefined) {
      return connectorStatus;
    }

    let session: BridgeSession | undefined;
    try {
      session = this.sessionManager.getSession(this.activeSessionId);
    } catch {
      this.activeSessionId = undefined;
      return connectorStatus;
    }

    return {
      ...connectorStatus,
      sessionActive: connectorStatus.sessionActive ?? true,
      sessionId: connectorStatus.sessionId ?? session.sessionId,
      sessionName: connectorStatus.sessionName ?? session.name
    };
  }

  async executeCommand(command: BridgeCommand): Promise<unknown> {
    const execution = this.commandQueue.then(() => this.executeCommandNow(command));
    this.commandQueue = execution.then(() => undefined, () => undefined);
    return execution;
  }

  private async executeCommandNow(command: BridgeCommand): Promise<unknown> {
    const session = this.sessionManager.getSession(command.sessionId);

    try {
      if (command.type !== "openTabs") {
        if (this.finalizedSessionIds.has(command.sessionId)) {
          throw new Error(`UMB session ${command.sessionId} is already finalized. Create a new session to continue browser control.`);
        }

        this.activeSessionId = session.sessionId;
        await this.connector.beginSession?.({
          sessionId: session.sessionId,
          clientId: session.clientId,
          name: session.name
        });
      }

      if (command.type === "nameSession") {
        const result = this.sessionManager.nameSession(
          command.sessionId,
          command.params.name
        );
        await this.connector.updateSession?.({
          sessionId: result.sessionId,
          name: result.name
        });
        await this.writeAudit(session, command, "ok");
        return result;
      }

      if (command.type === "goto" || (command.type === "newTab" && command.params.url)) {
        this.sessionManager.assertAllowed(command.sessionId, "navigate");
      }

      if (command.type === "fill") {
        this.sessionManager.assertAllowed(command.sessionId, "type");
      }

      if (command.type === "click" || command.type === "fill") {
        this.sessionManager.assertAllowed(command.sessionId, command.type);
      }

      if (command.type === "submit") {
        this.sessionManager.assertAllowed(command.sessionId, "submitForm");
      }

      if (command.type === "claimTab") {
        const result = await this.router(command);
        this.tabRegistry.track(command.sessionId, command.params.tabId);
        await this.writeAudit(session, command, "ok");
        return result;
      }

      if (command.type === "newTab") {
        const result = (await this.router(command)) as { id: string };
        this.tabRegistry.track(command.sessionId, result.id);
        await this.writeAudit(session, command, "ok", result.id);
        return result;
      }

      if (command.type !== "openTabs") {
        this.assertTrackedTab(command);
      }

      if (command.type === "finalize") {
        const ownedTabIds = this.tabRegistry.get(command.sessionId);
        const ownedTabIdSet = new Set(ownedTabIds);
        const invalidKeepEntry = command.params.keep.find(
          (entry) => !ownedTabIdSet.has(entry.id)
        );
        if (invalidKeepEntry) {
          throw new Error(
            `Tab ${invalidKeepEntry.id} is not owned by this session and cannot be kept during finalize.`
          );
        }

        const result = await this.connector.finalize({
          sessionId: command.sessionId,
          keep: command.params.keep,
          ownedTabIds
        });
        this.tabRegistry.replace(
          command.sessionId,
          command.params.keep.map((entry) => entry.id)
        );
        this.finalizedSessionIds.add(command.sessionId);
        if (this.activeSessionId === command.sessionId) {
          this.activeSessionId = undefined;
        }
        await this.writeAudit(session, command, "ok");
        return result;
      }

      const result = await this.router(command);
      await this.writeAudit(session, command, "ok");
      return result;
    } catch (error) {
      await this.writeAudit(
        session,
        command,
        "error",
        this.getTabId(command),
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  private assertTrackedTab(command: BridgeCommand): void {
    const tabId = this.getTabId(command);
    if (!tabId) {
      return;
    }

    if (!this.tabRegistry.isTracked(command.sessionId, tabId)) {
      throw new Error(`Tab ${tabId} is unknown to this session. Claim it first or create it through UMB.`);
    }
  }

  private getTabId(command: BridgeCommand): string | undefined {
    return hasTabId(command) ? command.params.tabId : undefined;
  }

  private extractOrigin(command: BridgeCommand): string | undefined {
    if (command.type !== "goto" && command.type !== "newTab") {
      return undefined;
    }
    const url = command.params.url;
    if (!url) {
      return undefined;
    }
    try {
      return new URL(url).origin;
    } catch {
      return undefined;
    }
  }

  private async writeAudit(
    session: BridgeSession,
    command: BridgeCommand,
    result: "ok" | "error",
    tabId = this.getTabId(command),
    message?: string
  ): Promise<void> {
    try {
      await this.auditLogger.write({
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        clientId: session.clientId,
        sessionName: session.name,
        commandType: command.type,
        tabId,
        origin: this.extractOrigin(command),
        result,
        message
      });
    } catch (error) {
      console.warn(
        `UMB audit log write failed for ${command.type} in session ${session.sessionId}.`,
        error
      );
    }
  }
}
