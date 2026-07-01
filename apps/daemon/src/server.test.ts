import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";

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
    expect(body).toContain('id="search"');
    expect(body).toContain('id="echo"');
    expect(body).toContain('id="go"');
  });
});
