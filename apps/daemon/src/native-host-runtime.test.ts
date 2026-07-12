import { describe, expect, it, vi } from "vitest";
import { buildAuthBootstrapUrl, handleRequest } from "./native-host-runtime.js";

describe("buildAuthBootstrapUrl", () => {
  it("targets the local auth bootstrap endpoint", () => {
    expect(buildAuthBootstrapUrl(undefined)).toBe(
      "http://127.0.0.1:44777/internal/auth-bootstrap"
    );
  });

  it("binds the bootstrap request to the current extension id", () => {
    expect(
      buildAuthBootstrapUrl("abcdefghijklmnopabcdefghijklmnop")
    ).toBe(
      "http://127.0.0.1:44777/internal/auth-bootstrap?extensionId=abcdefghijklmnopabcdefghijklmnop"
    );
  });
});

describe("handleRequest", () => {
  it("returns credentials fetched after starting a fresh daemon", async () => {
    const ensureDaemonRunning = vi.fn(async () => undefined);
    const fetchAuthBootstrap = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        token: "fresh-token",
        allowedOrigins: ["chrome-extension://fresh/"]
      });
    const fetchDaemonHealth = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        daemon: { pid: 1234, startedAt: "2026-07-12T00:00:00.000Z" }
      });

    await expect(
      handleRequest(
        { type: "getDaemonInfo", extensionId: "abcdefghijklmnopabcdefghijklmnop" },
        { ensureDaemonRunning, fetchAuthBootstrap, fetchDaemonHealth }
      )
    ).resolves.toMatchObject({
      ok: true,
      bearerToken: "fresh-token",
      allowedOrigins: ["chrome-extension://fresh/"],
      daemonPid: 1234,
      daemonStartedAt: "2026-07-12T00:00:00.000Z"
    });
    expect(ensureDaemonRunning).toHaveBeenCalledOnce();
    expect(fetchAuthBootstrap).toHaveBeenCalledTimes(2);
  });

  it("does not report success when auth bootstrap still has no credentials", async () => {
    await expect(
      handleRequest(
        { type: "getDaemonInfo" },
        {
          ensureDaemonRunning: async () => undefined,
          fetchAuthBootstrap: async () => null,
          fetchDaemonHealth: async () => null
        }
      )
    ).rejects.toThrow("auth bootstrap did not return credentials");
  });
});
