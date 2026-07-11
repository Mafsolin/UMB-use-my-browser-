import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { handleRequest } = vi.hoisted(() => ({ handleRequest: vi.fn() }));

vi.mock("./commands.js", () => ({ handleRequest }));
vi.mock("./bridge-auth.js", () => ({
  buildBridgeSubprotocols: vi.fn(() => ["umb-v1"]),
  hasBridgeBearerToken: vi.fn(() => true)
}));
vi.mock("./permissions.js", () => ({ verifyDetachedTabs: vi.fn() }));
vi.mock("./tabs.js", () => ({
  cleanupStaleTemporaryTabs: vi.fn(),
  cleanupStaleUmbGroupResidue: vi.fn()
}));
vi.mock("./debugger.js", () => ({ forceDetachDebugger: vi.fn() }));

class TestWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  readonly listeners = new Map<string, Array<(event: unknown) => unknown>>();
  readyState = TestWebSocket.CONNECTING;
  send = vi.fn();

  addEventListener(type: string, listener: (event: unknown) => unknown) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener(event);
    }
  }

  close() {}
}

describe("daemon connection messages", () => {
  beforeAll(() => {
    Object.assign(globalThis, {
      WebSocket: TestWebSocket,
      chrome: {
        action: {
          setBadgeBackgroundColor: vi.fn(),
          setBadgeText: vi.fn()
        },
        runtime: {
          onMessage: { addListener: vi.fn() }
        }
      },
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({})
      })
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    handleRequest.mockReset();
  });

  it("ignores malformed JSON without invoking the command handler", async () => {
    const { extensionState } = await import("./bridge-state.js");
    const { connectToDaemon } = await import("./connection.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    extensionState.socket = undefined;
    extensionState.bridgeBearerToken = "token";
    await connectToDaemon("ws://127.0.0.1:44777/extension");

    const socket = extensionState.socket as unknown as TestWebSocket;
    await expect(socket.dispatch("message", { data: "{" })).resolves.toBeUndefined();

    expect(handleRequest).not.toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "UMB received an invalid JSON request from the bridge.",
      expect.any(SyntaxError)
    );
  });
});
