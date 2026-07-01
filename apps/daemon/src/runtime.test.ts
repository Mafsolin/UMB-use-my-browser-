import { describe, expect, it } from "vitest";
import {
  generateBridgeAuth,
  parseAllowedOrigins
} from "./runtime.js";

describe("generateBridgeAuth", () => {
  it("generates a random bearer token when none is provided", () => {
    const auth = generateBridgeAuth();
    expect(typeof auth.bearerToken).toBe("string");
    expect(auth.bearerToken.length).toBeGreaterThan(0);
  });

  it("generates a different token for each call", () => {
    const a = generateBridgeAuth();
    const b = generateBridgeAuth();
    expect(a.bearerToken).not.toBe(b.bearerToken);
  });

  it("preserves a provided bearer token", () => {
    const auth = generateBridgeAuth({ token: "fixed-token" });
    expect(auth.bearerToken).toBe("fixed-token");
  });

  it("preserves provided allowed origins", () => {
    const auth = generateBridgeAuth({
      allowedOrigins: ["chrome-extension://specific-id/"]
    });
    expect(auth.allowedOrigins).toEqual(["chrome-extension://specific-id/"]);
  });

  it("defaults allowed origins to a chrome-extension wildcard when omitted", () => {
    const auth = generateBridgeAuth();
    expect(auth.allowedOrigins).toEqual(["chrome-extension://*"]);
  });
});

describe("parseAllowedOrigins", () => {
  it("returns the chrome-extension wildcard default for an empty value", () => {
    expect(parseAllowedOrigins(undefined)).toEqual(["chrome-extension://*"]);
    expect(parseAllowedOrigins("")).toEqual(["chrome-extension://*"]);
    expect(parseAllowedOrigins("   ")).toEqual(["chrome-extension://*"]);
  });

  it("splits a comma-separated list and trims entries", () => {
    expect(
      parseAllowedOrigins(
        " chrome-extension://a/ , https://example.com/, chrome-extension://b/"
      )
    ).toEqual([
      "chrome-extension://a/",
      "https://example.com/",
      "chrome-extension://b/"
    ]);
  });

  it("falls back to the default when the env value only has empty entries", () => {
    expect(parseAllowedOrigins(",,,")).toEqual(["chrome-extension://*"]);
  });
});
