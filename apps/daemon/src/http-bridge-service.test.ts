import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpBridgeService } from "./http-bridge-service.js";

const session = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  clientId: "mcp",
  createdAt: "2025-01-01T00:00:00.000Z",
  permissions: {
    allowNavigation: true,
    allowTyping: true,
    allowExternalSideEffects: false
  }
};

describe("HttpBridgeService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates and caches sessions through the daemon HTTP API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(session), { status: 201 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new HttpBridgeService("http://daemon.test/");

    await expect(service.createSession({
      clientId: "mcp",
      permissions: session.permissions
    })).resolves.toEqual(session);

    expect(service.getSession(session.sessionId)).toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith("http://daemon.test/sessions", {
      method: "POST",
      body: JSON.stringify({ clientId: "mcp", permissions: session.permissions }),
      headers: { "content-type": "application/json" }
    });
  });

  it("uses the daemon error message for unsuccessful responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Unknown session" }), { status: 404 })
    ));
    const service = new HttpBridgeService("http://daemon.test");

    await expect(service.executeCommand({
      type: "openTabs",
      sessionId: session.sessionId,
      params: {}
    })).rejects.toThrow("Unknown session");
  });

  it("updates the cached session after naming it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: { ...session, name: "Research" }
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new HttpBridgeService("http://daemon.test");
    await service.createSession({ clientId: "mcp", permissions: session.permissions });

    await expect(service.executeCommand({
      type: "nameSession",
      sessionId: session.sessionId,
      params: { name: "Research" }
    })).resolves.toEqual({ ...session, name: "Research" });

    expect(service.getSession(session.sessionId)).toEqual({ ...session, name: "Research" });
  });
});
