import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { startUmbDaemon } from "./runtime.js";

type BridgeRequest = {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
};

describe("daemon transport", () => {
  let daemon: Awaited<ReturnType<typeof startUmbDaemon>> | undefined;
  let extensionSocket: WebSocket | undefined;

  afterEach(async () => {
    if (extensionSocket && extensionSocket.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => {
        extensionSocket!.once("close", resolve);
        extensionSocket!.terminate();
      });
    }

    if (daemon) {
      await new Promise<void>((resolve, reject) => {
        daemon!.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("creates an HTTP session and routes an extension command over the authenticated WebSocket", async () => {
    const token = "transport-test-token";
    const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";
    daemon = await startUmbDaemon(0, {
      bearerToken: token,
      allowedOrigins: [origin]
    });
    const port = (daemon.server.address() as { port: number }).port;

    extensionSocket = await connectFakeExtension({ port, token, origin });
    const extensionRequests: BridgeRequest[] = [];
    extensionSocket.on("message", (raw) => {
      const request = JSON.parse(String(raw)) as BridgeRequest;
      extensionRequests.push(request);
      const result = request.type === "openTabs"
        ? [{ id: "transport-tab", title: "Routed tab", url: "https://example.test/" }]
        : undefined;
      extensionSocket!.send(JSON.stringify({ id: request.id, ok: true, result }));
    });

    const sessionResponse = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: "transport-test-client",
        permissions: {
          allowNavigation: true,
          allowTyping: true,
          allowExternalSideEffects: false
        }
      })
    });
    const session = (await sessionResponse.json()) as { sessionId: string; clientId: string };

    expect(sessionResponse.status).toBe(201);
    expect(session.clientId).toBe("transport-test-client");
    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const commandResponse = await fetch(`http://127.0.0.1:${port}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "openTabs",
        sessionId: session.sessionId,
        params: {}
      })
    });
    const command = (await commandResponse.json()) as {
      result: Array<{ id: string; title: string; url: string }>;
    };

    expect(commandResponse.status).toBe(200);
    expect(command.result).toEqual([
      { id: "transport-tab", title: "Routed tab", url: "https://example.test/" }
    ]);
    expect(extensionRequests).toContainEqual(expect.objectContaining({ type: "openTabs" }));
  });
});

async function connectFakeExtension(input: {
  port: number;
  token: string;
  origin: string;
}): Promise<WebSocket> {
  const socket = new WebSocket(
    `ws://127.0.0.1:${input.port}/extension`,
    ["umb-v1", `bearer.${input.token}`],
    { headers: { Origin: input.origin } }
  );
  socket.on("error", () => undefined);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  return socket;
}
