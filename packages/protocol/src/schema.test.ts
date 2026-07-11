import { describe, expect, it } from "vitest";
import {
  BridgeCommandType,
  bridgeCommandSchema,
  bridgeSessionSchema,
  clickCommandSchema,
  fillCommandSchema,
  findControlsCommandSchema,
  finalizeCommandSchema,
  gotoCommandSchema,
  nameSessionCommandSchema,
  newTabCommandSchema,
  openTabsCommandSchema,
  readPageCommandSchema,
  scrollCommandSchema,
  submitCommandSchema
} from "./schema.js";

const validSessionId = "123e4567-e89b-12d3-a456-426614174000";

describe("universal bridge protocol", () => {
  it("defines a client-neutral session shape", () => {
    const session = bridgeSessionSchema.parse({
      sessionId: validSessionId,
      clientId: "codex",
      createdAt: "2026-06-30T12:00:00.000Z",
      name: "shopping-handoff",
      permissions: {
        allowNavigation: true,
        allowTyping: true,
        allowExternalSideEffects: false
      }
    });

    expect(session.clientId).toBe("codex");
    expect(session.name).toBe("shopping-handoff");
  });

  it("defines the core browser command set", () => {
    const command = bridgeCommandSchema.parse({
      type: BridgeCommandType.NewTab,
      sessionId: validSessionId,
      params: {}
    });

    expect(command.type).toBe("newTab");
  });
});

describe("bridge command parsing - valid payloads", () => {
  it("accepts a newTab command with an optional URL", () => {
    const command = newTabCommandSchema.parse({
      type: "newTab",
      sessionId: validSessionId,
      params: { url: "https://www.google.com/" }
    });
    expect(command.params).toEqual({ url: "https://www.google.com/" });
  });

  it("accepts a newTab command without a URL", () => {
    const command = newTabCommandSchema.parse({
      type: "newTab",
      sessionId: validSessionId,
      params: {}
    });
    expect(command.params).toEqual({});
  });

  it("accepts an openTabs command with empty params", () => {
    const command = openTabsCommandSchema.parse({
      type: "openTabs",
      sessionId: validSessionId,
      params: {}
    });
    expect(command.params).toEqual({});
  });

  it("accepts a goto command with a valid tabId and url", () => {
    const command = gotoCommandSchema.parse({
      type: "goto",
      sessionId: validSessionId,
      params: { tabId: "tab-42", url: "https://www.google.com/" }
    });
    expect(command.params).toEqual({
      tabId: "tab-42",
      url: "https://www.google.com/"
    });
  });

  it("accepts a structured readPage command with controls", () => {
    const command = readPageCommandSchema.parse({
      type: "readPage",
      sessionId: validSessionId,
      params: { tabId: "t-1", format: "text", maxChars: 500, includeMetadata: false }
    });
    expect(command.params).toEqual({
      tabId: "t-1",
      format: "text",
      maxChars: 500,
      includeMetadata: false
    });
  });

  it("accepts findControls filters and applies defaults", () => {
    const defaults = findControlsCommandSchema.parse({
      type: "findControls",
      sessionId: validSessionId,
      params: { tabId: "t-1" }
    });
    expect(defaults.params).toEqual({ tabId: "t-1", visibleOnly: true, limit: 50 });

    const filtered = findControlsCommandSchema.parse({
      type: "findControls",
      sessionId: validSessionId,
      params: { tabId: "t-1", query: "save", kind: "button", visibleOnly: false, limit: 100 }
    });
    expect(filtered.params.kind).toBe("button");
  });

  it("accepts a click command with selector", () => {
    const command = clickCommandSchema.parse({
      type: "click",
      sessionId: validSessionId,
      params: { tabId: "t-1", selector: "button.buy" }
    });
    expect(command.params.selector).toBe("button.buy");
  });

  it("accepts a submit command with a selector", () => {
    const command = submitCommandSchema.parse({
      type: "submit",
      sessionId: validSessionId,
      params: { tabId: "t-1", selector: "form.checkout" }
    });
    expect(command.params.selector).toBe("form.checkout");
  });

  it("accepts a fill command with selector and value", () => {
    const command = fillCommandSchema.parse({
      type: "fill",
      sessionId: validSessionId,
      params: { tabId: "t-1", selector: "input", value: "hello" }
    });
    expect(command.params.value).toBe("hello");
  });

  it("accepts a scroll command with finite coordinates", () => {
    const command = scrollCommandSchema.parse({
      type: "scroll",
      sessionId: validSessionId,
      params: { tabId: "t-1", x: 0, y: 256 }
    });
    expect(command.params).toEqual({ tabId: "t-1", x: 0, y: 256 });
  });

  it("accepts a nameSession command with a non-empty name", () => {
    const command = nameSessionCommandSchema.parse({
      type: "nameSession",
      sessionId: validSessionId,
      params: { name: "weather" }
    });
    expect(command.params.name).toBe("weather");
  });

  it("accepts a finalize command with a typed keep list", () => {
    const command = finalizeCommandSchema.parse({
      type: "finalize",
      sessionId: validSessionId,
      params: {
        keep: [
          { id: "tab-1", status: "deliverable" },
          { id: "tab-2", status: "handoff" }
        ]
      }
    });
    expect(command.params.keep).toHaveLength(2);
  });
});

describe("bridge command parsing - invalid payloads", () => {
  it("rejects a non-UUID sessionId", () => {
    const result = bridgeCommandSchema.safeParse({
      type: "openTabs",
      sessionId: "not-a-uuid",
      params: {}
    });
    expect(result.success).toBe(false);
  });

  it("rejects a numeric tabId (must be string)", () => {
    const result = bridgeCommandSchema.safeParse({
      type: "getTitle",
      sessionId: validSessionId,
      params: { tabId: 999 }
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty tabId", () => {
    const result = bridgeCommandSchema.safeParse({
      type: "claimTab",
      sessionId: validSessionId,
      params: { tabId: "" }
    });
    expect(result.success).toBe(false);
  });

  it("rejects a tabId with unsupported characters", () => {
    const result = bridgeCommandSchema.safeParse({
      type: "claimTab",
      sessionId: validSessionId,
      params: { tabId: "bad id with space" }
    });
    expect(result.success).toBe(false);
  });

  it("rejects a newTab command with a non-URL url", () => {
    const result = newTabCommandSchema.safeParse({
      type: "newTab",
      sessionId: validSessionId,
      params: { url: "not a url" }
    });
    expect(result.success).toBe(false);
  });

  it("rejects a goto command with a non-URL url", () => {
    const result = gotoCommandSchema.safeParse({
      type: "goto",
      sessionId: validSessionId,
      params: { tabId: "t-1", url: "not a url" }
    });
    expect(result.success).toBe(false);
  });

  it("rejects findControls limits above the maximum", () => {
    expect(findControlsCommandSchema.safeParse({
      type: "findControls",
      sessionId: validSessionId,
      params: { tabId: "t-1", limit: 101 }
    }).success).toBe(false);
  });

  it("rejects a click command with an empty selector", () => {
    const result = clickCommandSchema.safeParse({
      type: "click",
      sessionId: validSessionId,
      params: { tabId: "t-1", selector: "" }
    });
    expect(result.success).toBe(false);
  });

  it("rejects a fill command missing the value", () => {
    const result = fillCommandSchema.safeParse({
      type: "fill",
      sessionId: validSessionId,
      params: { tabId: "t-1", selector: "input" }
    });
    expect(result.success).toBe(false);
  });

  it("rejects a scroll command with NaN coordinates", () => {
    const result = scrollCommandSchema.safeParse({
      type: "scroll",
      sessionId: validSessionId,
      params: { tabId: "t-1", x: Number.NaN, y: 10 }
    });
    expect(result.success).toBe(false);
  });

  it("rejects a scroll command with string coordinates", () => {
    const result = scrollCommandSchema.safeParse({
      type: "scroll",
      sessionId: validSessionId,
      params: { tabId: "t-1", x: "10", y: "20" }
    });
    expect(result.success).toBe(false);
  });

  it("rejects a nameSession with an empty name", () => {
    const result = nameSessionCommandSchema.safeParse({
      type: "nameSession",
      sessionId: validSessionId,
      params: { name: "" }
    });
    expect(result.success).toBe(false);
  });

  it("rejects a finalize with an unknown keep status", () => {
    const result = finalizeCommandSchema.safeParse({
      type: "finalize",
      sessionId: validSessionId,
      params: { keep: [{ id: "t-1", status: "wat" }] }
    });
    expect(result.success).toBe(false);
  });

  it("rejects a finalize with a keep entry that is missing id", () => {
    const result = finalizeCommandSchema.safeParse({
      type: "finalize",
      sessionId: validSessionId,
      params: { keep: [{ status: "deliverable" }] }
    });
    expect(result.success).toBe(false);
  });

  it("rejects extra fields inside params (strict mode)", () => {
    const result = bridgeCommandSchema.safeParse({
      type: "goto",
      sessionId: validSessionId,
      params: { tabId: "t-1", url: "https://www.google.com/", extra: true }
    });
    expect(result.success).toBe(false);
  });

  it("rejects extra top-level fields outside the union shape", () => {
    const result = bridgeCommandSchema.safeParse({
      type: "newTab",
      sessionId: validSessionId,
      params: {},
      extra: "nope"
    });
    expect(result.success).toBe(false);
  });
});

describe("bridge command discriminated union narrowing", () => {
  it("narrows params based on the type discriminator", () => {
    const command = bridgeCommandSchema.parse({
      type: "scroll",
      sessionId: validSessionId,
      params: { tabId: "t-1", x: 1, y: 2 }
    });

    if (command.type !== "scroll") {
      throw new Error("expected scroll command");
    }

    expect(command.params.x).toBe(1);
    expect(command.params.y).toBe(2);
  });
});
