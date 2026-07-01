import { describe, expect, it } from "vitest";
import { buildBridgeSubprotocols, hasBridgeBearerToken } from "./bridge-auth.js";

describe("buildBridgeSubprotocols", () => {
  it("includes the bearer subprotocol when a token is provided", () => {
    expect(buildBridgeSubprotocols("abc123")).toEqual([
      "umb-v1",
      "bearer.abc123"
    ]);
  });

  it("returns only the default protocol when no token is provided", () => {
    expect(buildBridgeSubprotocols(undefined)).toEqual(["umb-v1"]);
  });

  it("returns only the default protocol when the token is empty", () => {
    expect(buildBridgeSubprotocols("")).toEqual(["umb-v1"]);
  });

  it("preserves the bearer prefix verbatim for the daemon to validate", () => {
    const token = "01ab-cdef-2345";
    expect(buildBridgeSubprotocols(token)).toContain(`bearer.${token}`);
  });

  it("treats blank bridge tokens as missing", () => {
    expect(hasBridgeBearerToken(undefined)).toBe(false);
    expect(hasBridgeBearerToken("")).toBe(false);
    expect(hasBridgeBearerToken("   ")).toBe(false);
    expect(hasBridgeBearerToken("token")).toBe(true);
  });
});
