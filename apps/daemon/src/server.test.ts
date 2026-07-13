import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createServer,
  isLoopbackAddress,
  isValidChromiumExtensionId,
  originForExtensionId,
  resolveBootstrapAllowedOrigins
} from "./server.js";

describe("daemon server", () => {
  let server: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(async () => {
    server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("creates a bridge session", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: "codex",
        permissions: {
          allowNavigation: true,
          allowTyping: true,
          allowExternalSideEffects: false
        }
      })
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { clientId: string; sessionId: string };
    expect(body.clientId).toBe("codex");
    expect(body.sessionId).toMatch(/[0-9a-f-]{36}/);
  });

  it("rejects malformed JSON request bodies with a client error", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/json/i);
  });

  it("rejects oversized JSON request bodies", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: "x".repeat(256 * 1024),
        permissions: {
          allowNavigation: true,
          allowTyping: true,
          allowExternalSideEffects: false
        }
      })
    });

    expect(response.status).toBe(413);
  });

  it("rejects invalid session payloads with a client error", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: "",
        permissions: {
          allowNavigation: true,
          allowTyping: true,
          allowExternalSideEffects: false
        }
      })
    });

    expect(response.status).toBe(400);
  });

  it("rejects invalid command payloads with a client error", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "goto",
        sessionId: "not-a-uuid",
        params: { tabId: "tab-1", url: "not-a-url" }
      })
    });

    expect(response.status).toBe(400);
  });

  it("reports extension connection state in health output", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = (await response.json()) as {
      ok: boolean;
      extension: { connected: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.extension.connected).toBe(true);
  });

  it("serves the local UMB interaction test page", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/umb-test-page`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("UMB Local Test Page");
    expect(body).toContain('id="search-form"');
    expect(body).toContain('id="search"');
    expect(body).toContain('id="echo"');
    expect(body).toContain('id="go"');
    expect(body).toContain('id="submit-button"');
    expect(body).toContain('id="submit-result"');
    expect(body).toContain('id="composer"');
    expect(body).toContain('contenteditable="true"');
    expect(body).toContain('id="composer-input-count"');
    expect(body).toContain('id="composer-keyboard-count"');
    expect(body).toContain("event.key === 'Enter'");
    expect(body).toContain('id="composer-send-count"');
  });

  it("returns 503 for auth bootstrap when no bridge auth is configured", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/internal/auth-bootstrap`);
    expect(response.status).toBe(503);
  });
});

describe("auth bootstrap helpers", () => {
  it("recognizes loopback addresses only", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.10")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  it("validates Chromium extension ids", () => {
    expect(isValidChromiumExtensionId("abcdefghijklmnopabcdefghijklmnop")).toBe(true);
    expect(isValidChromiumExtensionId("abc")).toBe(false);
    expect(isValidChromiumExtensionId("not-an-extension-id-1234567890")).toBe(false);
    expect(isValidChromiumExtensionId(undefined)).toBe(false);
  });

  it("builds an exact extension origin", () => {
    expect(originForExtensionId("ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP")).toBe(
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
    );
  });

  it("does not mutate configured origins when resolving bootstrap origins", () => {
    const configured = ["chrome-extension://*"];
    const resolved = resolveBootstrapAllowedOrigins(
      configured,
      "abcdefghijklmnopabcdefghijklmnop"
    );

    expect(resolved).toEqual([
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
    ]);
    expect(configured).toEqual(["chrome-extension://*"]);
  });
});

describe("daemon server with bridge auth configured", () => {
  let server: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(async () => {
    server = createServer(undefined, {
      bearerToken: "test-bearer-token",
      allowedOrigins: ["chrome-extension://*"]
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("exposes an exact extension origin for the requesting extension id", async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}/internal/auth-bootstrap?extensionId=abcdefghijklmnopabcdefghijklmnop`
    );
    const body = (await response.json()) as {
      token: string;
      allowedOrigins: string[];
    };

    expect(response.status).toBe(200);
    expect(body.token).toBe("test-bearer-token");
    expect(body.allowedOrigins).toEqual([
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
    ]);
  });

  it("rejects invalid extension ids for auth bootstrap", async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}/internal/auth-bootstrap?extensionId=not-valid`
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/invalid chromium extension id/i);
  });
});
