import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bridgeCommandSchema } from "@umb/protocol";
import { FakeConnector } from "@umb/core";
import { AuditLogger } from "./audit-log.js";
import { BridgeService } from "./bridge-service.js";

describe("BridgeService", () => {
  it("requires claimed tabs before read commands", async () => {
    const service = new BridgeService(new FakeConnector());
    const session = service.createSession({
      clientId: "mcp",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: true
      }
    });

    const tab = await service.executeCommand({
      type: "newTab",
      sessionId: session.sessionId,
      params: {}
    });

    await expect(
      service.executeCommand({
        type: "getTitle",
        sessionId: session.sessionId,
        params: { tabId: "999" }
      })
    ).rejects.toThrow(/unknown to this session/i);

    await expect(
      service.executeCommand({
        type: "getTitle",
        sessionId: session.sessionId,
        params: { tabId: (tab as { id: string }).id }
      })
    ).resolves.toBe("New Tab");
  });

  it("renames sessions and writes audit records", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "umb-audit-"));
    const auditLogger = new AuditLogger(path.join(tempDir, "audit.jsonl"));
    const service = new BridgeService(new FakeConnector(), auditLogger);
    const session = service.createSession({
      clientId: "claude-code",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: true
      }
    });

    const renamed = await service.executeCommand({
      type: "nameSession",
      sessionId: session.sessionId,
      params: { name: "docs-pass" }
    });

    expect((renamed as { name: string }).name).toBe("docs-pass");
    const auditText = await readFile(auditLogger.getPath(), "utf8");
    expect(auditText).toMatch(/docs-pass|nameSession/);
  });

  it("blocks navigation when permissions disable it", async () => {
    const service = new BridgeService(new FakeConnector());
    const session = service.createSession({
      clientId: "gemini-cli",
      permissions: {
        allowNavigation: false,
        allowTyping: true,
        allowExternalSideEffects: true
      }
    });

    const tab = (await service.executeCommand({
      type: "newTab",
      sessionId: session.sessionId,
      params: {}
    })) as { id: string };

    await expect(
      service.executeCommand({
        type: "goto",
        sessionId: session.sessionId,
        params: { tabId: tab.id, url: "https://www.google.com/" }
      })
    ).rejects.toThrow(/navigation is disabled/i);
  });

  it("blocks submit when external side effects are disabled", async () => {
    const service = new BridgeService(new FakeConnector());
    const session = service.createSession({
      clientId: "submit-check",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: false
      }
    });

    const tab = (await service.executeCommand({
      type: "newTab",
      sessionId: session.sessionId,
      params: {}
    })) as { id: string };

    await expect(
      service.executeCommand({
        type: "submit",
        sessionId: session.sessionId,
        params: { tabId: tab.id, selector: "#go" }
      })
    ).rejects.toThrow(/side effects are disabled/i);
  });

  it("returns scroll coordinates from the live connector contract", async () => {
    const service = new BridgeService(new FakeConnector());
    const session = service.createSession({
      clientId: "scroll-check",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: true
      }
    });

    const tab = (await service.executeCommand({
      type: "newTab",
      sessionId: session.sessionId,
      params: {}
    })) as { id: string };

    await expect(
      service.executeCommand({
        type: "scroll",
        sessionId: session.sessionId,
        params: { tabId: tab.id, x: 12, y: 345 }
      })
    ).resolves.toEqual({ x: 12, y: 345 });
  });

  it("finalize only sends tabs owned by the current session", async () => {
    const finalizeCalls: Array<{ sessionId: string; keep: Array<{ id: string; status: "deliverable" | "handoff" }>; ownedTabIds: string[] }> = [];
    const connector = new FakeConnector();
    const originalFinalize = connector.finalize.bind(connector);
    connector.finalize = async (request) => {
      finalizeCalls.push(request);
      return originalFinalize(request);
    };

    const service = new BridgeService(connector);
    const sessionA = service.createSession({
      clientId: "session-a",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: true
      }
    });
    const sessionB = service.createSession({
      clientId: "session-b",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: true
      }
    });

    const tabA = (await service.executeCommand({
      type: "newTab",
      sessionId: sessionA.sessionId,
      params: {}
    })) as { id: string };
    const tabB = (await service.executeCommand({
      type: "newTab",
      sessionId: sessionB.sessionId,
      params: {}
    })) as { id: string };

    await service.executeCommand({
      type: "finalize",
      sessionId: sessionA.sessionId,
      params: { keep: [] }
    });

    expect(finalizeCalls).toHaveLength(1);
    expect(finalizeCalls[0]).toEqual({
      sessionId: sessionA.sessionId,
      keep: [],
      ownedTabIds: [tabA.id]
    });

    const remainingTabs = await connector.openTabs();
    expect(remainingTabs.map((tab) => tab.id)).toContain(tabB.id);
    expect(remainingTabs.map((tab) => tab.id)).not.toContain(tabA.id);
  });

  it("activates the bridge session when creating and naming sessions", async () => {
    const connector = new FakeConnector();
    const service = new BridgeService(connector);

    const session = service.createSession({
      clientId: "umb-mcp",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: false
      }
    });

    await service.executeCommand({
      type: "nameSession",
      sessionId: session.sessionId,
      params: { name: "weather" }
    });

    expect(connector.getConnectionStatus?.()).toMatchObject({
      sessionActive: true,
      sessionId: session.sessionId,
      sessionName: "weather"
    });
  });

  it("clears stale active session data when the live connector reports idle", async () => {
    const connector = new FakeConnector();
    const service = new BridgeService(connector);
    const session = service.createSession({
      clientId: "umb-http",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: false
      }
    });

    await service.executeCommand({
      type: "nameSession",
      sessionId: session.sessionId,
      params: { name: "idle-check" }
    });

    connector.getLiveConnectionStatus = async () => ({
      connected: true,
      clientLabel: "UMB Chrome extension",
      sessionActive: false,
      sessionId: undefined,
      sessionName: undefined,
      attachedTabCount: 0,
      connectedProcessLabel: "daemon:999"
    });

    await expect(service.getConnectionStatus()).resolves.toMatchObject({
      connected: true,
      sessionActive: false,
      attachedTabCount: 0,
      connectedProcessLabel: "daemon:999",
      sessionId: undefined,
      sessionName: undefined
    });
  });

  it("does not reactivate a finalized session during openTabs", async () => {
    const connector = new FakeConnector();
    const service = new BridgeService(connector);
    const session = service.createSession({
      clientId: "umb-http",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: true
      }
    });

    await service.executeCommand({
      type: "newTab",
      sessionId: session.sessionId,
      params: {}
    });

    await service.executeCommand({
      type: "finalize",
      sessionId: session.sessionId,
      params: { keep: [] }
    });

    await service.executeCommand({
      type: "openTabs",
      sessionId: session.sessionId,
      params: {}
    });

    await expect(service.getConnectionStatus()).resolves.toMatchObject({
      connected: true,
      sessionActive: false,
      sessionId: undefined,
      sessionName: undefined,
      attachedTabCount: 0
    });
  });

  it("rejects browser-control commands after finalize", async () => {
    const connector = new FakeConnector();
    const service = new BridgeService(connector);
    const session = service.createSession({
      clientId: "umb-http",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: true
      }
    });

    const tab = (await service.executeCommand({
      type: "newTab",
      sessionId: session.sessionId,
      params: {}
    })) as { id: string };

    await service.executeCommand({
      type: "finalize",
      sessionId: session.sessionId,
      params: { keep: [] }
    });

    await expect(
      service.executeCommand({
        type: "goto",
        sessionId: session.sessionId,
        params: { tabId: tab.id, url: "https://www.google.com/" }
      })
    ).rejects.toThrow(/already finalized/i);
  });

  it("rejects raw payloads whose tabId is not a string before reaching the router", async () => {
    const connector = new FakeConnector();
    const finalCalls: unknown[] = [];
    connector.finalize = (async (request: { keep: unknown[]; sessionId: string; ownedTabIds: string[] }) => {
      finalCalls.push(request);
      return { kept: request.keep, closed: [], released: [] };
    }) as never;

    const service = new BridgeService(connector);
    const session = service.createSession({
      clientId: "umb-zod",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: true
      }
    });

    const parse = bridgeCommandSchema.safeParse({
      type: "getTitle",
      sessionId: session.sessionId,
      params: { tabId: 999 }
    });

    expect(parse.success).toBe(false);

    if (parse.success) {
      await expect(service.executeCommand(parse.data)).rejects.toThrow();
    }

    expect(finalCalls).toHaveLength(0);
  });
});
