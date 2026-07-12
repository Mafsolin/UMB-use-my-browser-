import { describe, expect, it, vi } from "vitest";
import {
  ensureDaemonRunning,
  isDaemonHealthy,
  resolveDaemonEndpoints
} from "./daemon-lifecycle.js";

function healthResponse(overrides: Record<string, unknown> = {}): Response {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      daemon: { pid: 1234, startedAt: "2026-07-12T00:00:00.000Z" },
      extension: { connected: false },
      ...overrides
    })
  } as Response;
}

function jsonResponse(payload: unknown): Response {
  return { ok: true, json: async () => payload } as Response;
}

function unhealthyResponse(): Response {
  return { ok: false, json: async () => ({}) } as Response;
}

function child() {
  return { once: vi.fn(), unref: vi.fn() };
}

describe("resolveDaemonEndpoints", () => {
  it("derives the custom port and WebSocket URL", () => {
    expect(resolveDaemonEndpoints({
      daemonHttpUrl: "http://localhost:45000",
      env: {}
    })).toEqual({
      httpUrl: "http://localhost:45000",
      wsUrl: "ws://localhost:45000/extension",
      port: 45000
    });
  });

  it("uses UMB_DAEMON_PORT when no URL is configured", () => {
    expect(resolveDaemonEndpoints({ env: { UMB_DAEMON_PORT: "45000" } })).toEqual({
      httpUrl: "http://127.0.0.1:45000",
      wsUrl: "ws://127.0.0.1:45000/extension",
      port: 45000
    });
  });

  it("accepts a URL and port that resolve consistently", () => {
    expect(resolveDaemonEndpoints({
      daemonHttpUrl: "http://127.0.0.1:45000/",
      daemonPort: 45000,
      env: {}
    }).port).toBe(45000);
  });

  it("rejects a URL and UMB_DAEMON_PORT conflict", () => {
    expect(() => resolveDaemonEndpoints({
      daemonHttpUrl: "http://127.0.0.1:45000",
      daemonPort: "44777",
      env: {}
    })).toThrow("conflicts");
  });

  it("rejects non-loopback daemon URLs", () => {
    expect(() => resolveDaemonEndpoints({
      daemonHttpUrl: "http://192.168.1.2:44777",
      env: {}
    })).toThrow("loopback");
  });
});

describe("daemon health", () => {
  it("validates the complete health response schema", async () => {
    for (const payload of [
      {},
      { ok: true },
      { ok: true, daemon: { pid: 1, startedAt: "now" }, extension: {} },
      { ok: true, daemon: { pid: "1", startedAt: "2026-07-12T00:00:00Z" }, extension: { connected: true } },
      { ok: true, daemon: { pid: 1.5, startedAt: "2026-07-12T00:00:00Z" }, extension: { connected: true } },
      { ok: true, daemon: { pid: 1, startedAt: "not-a-date" }, extension: { connected: true } },
      { ok: false, daemon: { pid: 1, startedAt: "2026-07-12T00:00:00Z" }, extension: { connected: true } }
    ]) {
      await expect(isDaemonHealthy(
        "http://127.0.0.1:44777",
        vi.fn(async () => jsonResponse(payload))
      )).resolves.toBe(false);
    }
  });

  it("accepts a healthy daemon with a disconnected extension", async () => {
    await expect(isDaemonHealthy(
      "http://127.0.0.1:44777",
      vi.fn(async () => healthResponse())
    )).resolves.toBe(true);
  });

  it("passes a timeout abort signal to fetch", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return healthResponse();
    });
    await expect(isDaemonHealthy("http://127.0.0.1:44777", fetch, 25)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("ensureDaemonRunning", () => {
  it("does not spawn for a healthy daemon", async () => {
    const spawn = vi.fn();
    await ensureDaemonRunning({
      daemonHttpUrl: "http://127.0.0.1:44777",
      env: {},
      fetch: vi.fn(async () => healthResponse()),
      spawn
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not check or spawn for a non-loopback URL", async () => {
    const fetch = vi.fn();
    const spawn = vi.fn();
    await expect(ensureDaemonRunning({
      daemonHttpUrl: "http://example.com:44777",
      env: {},
      fetch,
      spawn
    })).rejects.toThrow("loopback");
    expect(fetch).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("passes normalized endpoint environment to a detached daemon", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(unhealthyResponse())
      .mockResolvedValueOnce(unhealthyResponse())
      .mockResolvedValueOnce(healthResponse());
    const spawned = child();
    const spawn = vi.fn(() => spawned);
    await ensureDaemonRunning({
      daemonHttpUrl: "http://localhost:45000/",
      env: { KEEP_ME: "yes" },
      runtimePath: "C:/umb/runtime.js",
      fetch,
      spawn,
      access: vi.fn(async () => undefined),
      sleep: vi.fn(async () => undefined)
    });
    expect(spawn).toHaveBeenCalledWith(process.execPath, ["C:/umb/runtime.js"], {
      detached: true,
      env: {
        KEEP_ME: "yes",
        UMB_DAEMON_PORT: "45000",
        UMB_DAEMON_HTTP_URL: "http://localhost:45000",
        UMB_DAEMON_WS_URL: "ws://localhost:45000/extension"
      },
      stdio: "ignore",
      windowsHide: true
    });
    expect(spawned.unref).toHaveBeenCalledOnce();
  });

  it("avoids spawning when another process wins the startup race", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(unhealthyResponse())
      .mockResolvedValueOnce(healthResponse());
    const spawn = vi.fn();
    await ensureDaemonRunning({
      daemonHttpUrl: "http://127.0.0.1:45001",
      env: {},
      runtimePath: "runtime.js",
      fetch,
      spawn,
      access: vi.fn(async () => undefined)
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("coalesces concurrent startup attempts", async () => {
    let healthy = false;
    const fetch = vi.fn(async () => healthy ? healthResponse() : unhealthyResponse());
    const spawn = vi.fn(() => child());
    const options = {
      daemonHttpUrl: "http://127.0.0.1:45002",
      env: {},
      runtimePath: "runtime.js",
      fetch,
      spawn,
      access: vi.fn(async () => undefined),
      sleep: vi.fn(async () => { healthy = true; })
    };
    await Promise.all([ensureDaemonRunning(options), ensureDaemonRunning(options)]);
    expect(spawn).toHaveBeenCalledOnce();
  });
});
