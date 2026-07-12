import http from "node:http";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionConnector, verifyBridgeHandshake } from "./extension-connector.js";

describe("verifyBridgeHandshake", () => {
  const expectedToken = "expected-secret-token";

  it("accepts a matching bearer token and allowed chrome-extension origin", () => {
    const result = verifyBridgeHandshake({
      origin: "chrome-extension://abcdefghijklmnop/",
      protocols: ["umb-v1", `bearer.${expectedToken}`],
      expectedToken,
      allowedOrigins: ["chrome-extension://*"]
    });

    expect(result).toEqual({ ok: true, protocol: "umb-v1" });
  });

  it("accepts an exact origin when listed explicitly", () => {
    const result = verifyBridgeHandshake({
      origin: "chrome-extension://abcdefghijklmnop/",
      protocols: [`bearer.${expectedToken}`, "umb-v1"],
      expectedToken,
      allowedOrigins: ["chrome-extension://abcdefghijklmnop/"]
    });

    expect(result.ok).toBe(true);
  });

  it("rejects connections without a bearer subprotocol", () => {
    const result = verifyBridgeHandshake({
      origin: "chrome-extension://abcdefghijklmnop/",
      protocols: ["umb-v1"],
      expectedToken,
      allowedOrigins: ["chrome-extension://*"]
    });

    expect(result).toEqual({
      ok: false,
      reason: "Missing bearer token in WebSocket subprotocols."
    });
  });

  it("rejects connections with a wrong bearer token", () => {
    const result = verifyBridgeHandshake({
      origin: "chrome-extension://abcdefghijklmnop/",
      protocols: ["umb-v1", "bearer.wrong-token"],
      expectedToken,
      allowedOrigins: ["chrome-extension://*"]
    });

    expect(result).toEqual({
      ok: false,
      reason: "Invalid bearer token in WebSocket subprotocols."
    });
  });

  it("rejects connections with an empty bearer token", () => {
    const result = verifyBridgeHandshake({
      origin: "chrome-extension://abcdefghijklmnop/",
      protocols: ["umb-v1", "bearer."],
      expectedToken,
      allowedOrigins: ["chrome-extension://*"]
    });

    expect(result).toEqual({
      ok: false,
      reason: "Invalid bearer token in WebSocket subprotocols."
    });
  });

  it("rejects connections with a missing origin", () => {
    const result = verifyBridgeHandshake({
      origin: undefined,
      protocols: ["umb-v1", `bearer.${expectedToken}`],
      expectedToken,
      allowedOrigins: ["chrome-extension://*"]
    });

    expect(result).toEqual({
      ok: false,
      reason: "Missing Origin header on WebSocket upgrade."
    });
  });

  it("rejects connections from origins outside the allowlist", () => {
    const result = verifyBridgeHandshake({
      origin: "https://attacker.example/",
      protocols: ["umb-v1", `bearer.${expectedToken}`],
      expectedToken,
      allowedOrigins: ["chrome-extension://*"]
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not in the UMB bridge allowlist/i);
    }
  });

  it("rejects connections from disallowed chrome-extension ids", () => {
    const result = verifyBridgeHandshake({
      origin: "chrome-extension://zzzzzzzzzzzzzzzz/",
      protocols: ["umb-v1", `bearer.${expectedToken}`],
      expectedToken,
      allowedOrigins: ["chrome-extension://abcdefghijklmnop/"]
    });

    expect(result.ok).toBe(false);
  });

  it("normalizes Set-style protocol input from the ws library", () => {
    const protocols = new Set(["umb-v1", `bearer.${expectedToken}`]);
    const result = verifyBridgeHandshake({
      origin: "chrome-extension://abcdefghijklmnop/",
      protocols,
      expectedToken,
      allowedOrigins: ["chrome-extension://*"]
    });

    expect(result).toEqual({ ok: true, protocol: "umb-v1" });
  });

  it("rejects a bearer token without the required umb-v1 protocol", () => {
    const result = verifyBridgeHandshake({
      origin: "chrome-extension://abcdefghijklmnop/",
      protocols: [`bearer.${expectedToken}`],
      expectedToken,
      allowedOrigins: ["chrome-extension://*"]
    });

    expect(result).toEqual({
      ok: false,
      reason: "Missing required umb-v1 WebSocket subprotocol."
    });
  });
});

describe("ExtensionConnector WebSocket transport", () => {
  const token = "expected-secret-token";
  const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";
  let server: http.Server | undefined;
  let connector: ExtensionConnector | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(sockets.splice(0).map(closeSocket));
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
    }
    server = undefined;
    connector = undefined;
  });

  it.each([
    { name: "missing bearer protocol", protocols: ["umb-v1"], requestOrigin: origin },
    { name: "missing umb-v1 protocol", protocols: [`bearer.${token}`], requestOrigin: origin },
    { name: "wrong bearer protocol", protocols: ["umb-v1", "bearer.wrong"], requestOrigin: origin },
    {
      name: "disallowed origin",
      protocols: ["umb-v1", `bearer.${token}`],
      requestOrigin: "https://attacker.example/"
    }
  ])("rejects an HTTP upgrade with $name before connection", async ({ protocols, requestOrigin }) => {
    const connection = vi.fn();
    const setup = await startConnectorServer(token, origin, connection);
    server = setup.server;
    connector = setup.connector;

    const result = await attemptConnection(setup.port, protocols, requestOrigin);

    expect(result.opened).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(connection).not.toHaveBeenCalled();
    expect(connector.getConnectionStatus().connected).toBe(false);
  });

  it.each([
    { name: "malformed JSON", response: "not-json" },
    { name: "missing id", response: JSON.stringify({ ok: true }) },
    { name: "non-boolean ok", response: JSON.stringify({ id: "response-id", ok: "yes" }) },
    {
      name: "non-string error",
      response: JSON.stringify({ id: "response-id", ok: false, error: { message: "bad" } })
    }
  ])("closes a socket that sends a $name response without crashing", async ({ response }) => {
    const setup = await startConnectorServer(token, origin);
    server = setup.server;
    connector = setup.connector;
    const socket = await connect(setup.port, token, origin);
    sockets.push(socket);

    const closed = waitForClose(socket);
    socket.send(response);

    await expect(closed).resolves.toMatchObject({ code: 1007 });
    expect(connector.getConnectionStatus().connected).toBe(false);
    await expect(fetch(`http://127.0.0.1:${setup.port}/health`)).resolves.toMatchObject({ status: 200 });
  });

  it("keeps a replacement socket and its pending request when the old socket closes", async () => {
    const setup = await startConnectorServer(token, origin);
    server = setup.server;
    connector = setup.connector;
    const oldSocket = await connect(setup.port, token, origin);
    sockets.push(oldSocket);
    const oldClosed = waitForClose(oldSocket);

    const newSocket = await connect(setup.port, token, origin);
    sockets.push(newSocket);
    const requestReceived = new Promise<BridgeRequest>((resolve) => {
      newSocket.once("message", (raw) => resolve(JSON.parse(String(raw)) as BridgeRequest));
    });
    const pending = connector.openTabs();
    const request = await requestReceived;

    await expect(oldClosed).resolves.toMatchObject({ code: 1000 });
    expect(connector.getConnectionStatus().connected).toBe(true);

    newSocket.send(JSON.stringify({
      id: request.id,
      ok: true,
      result: [{ id: "replacement-tab", title: "Replacement", url: "https://example.test/" }]
    }));

    await expect(pending).resolves.toEqual([
      { id: "replacement-tab", title: "Replacement", url: "https://example.test/" }
    ]);
    expect(connector.getConnectionStatus().connected).toBe(true);
  });
});

type BridgeRequest = {
  id: string;
  type: string;
};

async function startConnectorServer(
  token: string,
  origin: string,
  onConnection?: () => void
): Promise<{ connector: ExtensionConnector; server: http.Server; port: number }> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end("ok");
  });
  const connector = new ExtensionConnector({ bearerToken: token, allowedOrigins: [origin] }, 1000);
  const wsServer = connector.attachToServer(server);
  if (onConnection) {
    wsServer.on("connection", onConnection);
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    connector,
    server,
    port: (server.address() as { port: number }).port
  };
}

async function connect(port: number, token: string, origin: string): Promise<WebSocket> {
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/extension`,
    ["umb-v1", `bearer.${token}`],
    { headers: { Origin: origin } }
  );
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

async function attemptConnection(
  port: number,
  protocols: string[],
  origin: string
): Promise<{ opened: boolean; statusCode?: number }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/extension`, protocols, {
    headers: { Origin: origin }
  });
  return new Promise((resolve) => {
    socket.once("open", () => {
      socket.terminate();
      resolve({ opened: true });
    });
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve({ opened: false, statusCode: response.statusCode });
    });
    socket.once("error", () => resolve({ opened: false }));
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }
  await new Promise<void>((resolve) => {
    socket.once("close", resolve);
    socket.terminate();
  });
}
