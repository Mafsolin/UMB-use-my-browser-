import { describe, expect, it } from "vitest";
import { verifyBridgeHandshake } from "./extension-connector.js";

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

  it("falls back to umb-v1 when only a bearer subprotocol is provided", () => {
    const result = verifyBridgeHandshake({
      origin: "chrome-extension://abcdefghijklmnop/",
      protocols: [`bearer.${expectedToken}`],
      expectedToken,
      allowedOrigins: ["chrome-extension://*"]
    });

    expect(result).toEqual({ ok: true, protocol: "umb-v1" });
  });
});
