import { describe, expect, it } from "vitest";
import { buildAuthBootstrapUrl } from "./native-host-runtime.js";

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
