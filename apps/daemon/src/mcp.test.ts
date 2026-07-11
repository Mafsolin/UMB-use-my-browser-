import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { BridgeCommand, BridgePermissions, BridgeSession } from "@umb/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUmbMcpServer } from "./mcp.js";
import type { CommandCapableBridge } from "./http-bridge-service.js";

class FakeMcpBridge implements CommandCapableBridge {
  readonly sessions = new Map<string, BridgeSession>();
  readonly commands: BridgeCommand[] = [];
  private nextSession = 1;

  createSession(input: { clientId: string; permissions: BridgePermissions }): BridgeSession {
    const session: BridgeSession = {
      sessionId: `00000000-0000-4000-8000-${String(this.nextSession++).padStart(12, "0")}`,
      clientId: input.clientId,
      createdAt: "2025-01-01T00:00:00.000Z",
      permissions: input.permissions
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string): BridgeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown MCP session ${sessionId}. Create it first with umb_create_session.`);
    }
    return session;
  }

  async executeCommand(command: BridgeCommand): Promise<unknown> {
    this.commands.push(command);
    if (command.type === "nameSession") {
      const session = { ...this.getSession(command.sessionId), name: command.params.name };
      this.sessions.set(command.sessionId, session);
      return session;
    }
    return { type: command.type };
  }
}

describe("UMB MCP server", () => {
  let bridge: FakeMcpBridge;
  let client: Client;
  let server: ReturnType<typeof createUmbMcpServer>;

  beforeEach(async () => {
    bridge = new FakeMcpBridge();
    server = createUmbMcpServer(bridge);
    client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("registers the browser tools", async () => {
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "umb_create_session",
      "umb_open_tabs",
      "umb_goto",
      "umb_finalize"
    ]));
  });

  it("creates a session and uses it as the current session", async () => {
    const created = await client.callTool({
      name: "umb_create_session",
      arguments: { clientId: "codex", name: "Research" }
    });
    const session = JSON.parse((created as { content: Array<{ text: string }> }).content[0].text) as BridgeSession;

    expect(session).toMatchObject({ clientId: "codex", name: "Research" });
    expect(bridge.commands).toContainEqual({
      type: "nameSession",
      sessionId: session.sessionId,
      params: { name: "Research" }
    });

    await client.callTool({ name: "umb_open_tabs", arguments: {} });
    expect(bridge.commands).toContainEqual({
      type: "openTabs",
      sessionId: session.sessionId,
      params: {}
    });
  });

  it("rejects commands for sessions not created through MCP", async () => {
    const result = await client.callTool({
      name: "umb_get_title",
      arguments: {
        sessionId: "00000000-0000-4000-8000-000000000999",
        tabId: "tab-1"
      }
    });

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/Unknown MCP session/) }]
    });
  });
});
