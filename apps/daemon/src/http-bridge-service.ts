import type { BridgeCommand, BridgePermissions, BridgeSession } from "@umb/protocol";
import { routes } from "./routes.js";

type CommandCapableBridge = {
  createSession(input: {
    clientId: string;
    permissions: BridgePermissions;
  }): Promise<BridgeSession> | BridgeSession;
  getSession(sessionId: string): BridgeSession;
  executeCommand(command: BridgeCommand): Promise<unknown>;
};

type JsonResponse<T> = {
  status: number;
  body: T;
};

export class HttpBridgeService implements CommandCapableBridge {
  private readonly baseUrl: string;
  private readonly sessions = new Map<string, BridgeSession>();

  constructor(baseUrl = process.env.UMB_DAEMON_HTTP_URL ?? "http://127.0.0.1:44777") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async createSession(input: {
    clientId: string;
    permissions: BridgePermissions;
  }): Promise<BridgeSession> {
    const response = await this.requestJson<BridgeSession>(routes.createSession, {
      method: "POST",
      body: JSON.stringify(input)
    });
    this.sessions.set(response.body.sessionId, response.body);
    return response.body;
  }

  getSession(sessionId: string): BridgeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown MCP session ${sessionId}. Create it first with create_session.`);
    }

    return session;
  }

  async executeCommand(command: BridgeCommand): Promise<unknown> {
    const response = await this.requestJson<{ result: unknown }>(routes.command, {
      method: "POST",
      body: JSON.stringify(command)
    });

    if (command.type === "nameSession") {
      const existing = this.sessions.get(command.sessionId);
      const result = response.body.result as Partial<BridgeSession> | undefined;
      if (existing && typeof result?.name === "string") {
        this.sessions.set(command.sessionId, {
          ...existing,
          name: result.name
        });
      }
    }

    if (command.type === "finalize") {
      const existing = this.sessions.get(command.sessionId);
      if (existing) {
        this.sessions.set(command.sessionId, {
          ...existing
        });
      }
    }

    return response.body.result;
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<JsonResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });

    const body = (await response.json().catch(() => ({}))) as T | { error?: string };
    if (!response.ok) {
      const message =
        typeof (body as { error?: string }).error === "string"
          ? (body as { error?: string }).error
          : `UMB daemon request failed with status ${response.status}.`;
      throw new Error(message);
    }

    return {
      status: response.status,
      body: body as T
    };
  }
}

export type { CommandCapableBridge };
