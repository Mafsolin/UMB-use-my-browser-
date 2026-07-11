import { describe, expect, it } from "vitest";
import {
  bridgeCommandSchema,
  type BridgeCommand
} from "@umb/protocol";
import { createCommandRouter } from "./command-router.js";

describe("command router", () => {
  it("routes newTab URL to the browser transport", async () => {
    let calledWith: string | undefined;
    const router = createCommandRouter({
      newTab: async (url?: string) => {
        calledWith = url;
        return { id: "1" };
      }
    } as never);

    await router({
      type: "newTab",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      params: { url: "https://www.google.com/" }
    });

    expect(calledWith).toBe("https://www.google.com/");
  });

  it("forwards typed goto params without coercion", async () => {
    let observed: { tabId: string; url: string } | undefined;
    const router = createCommandRouter({
      goto: async (tabId: string, url: string) => {
        observed = { tabId, url };
      }
    } as never);

    const command = bridgeCommandSchema.parse({
      type: "goto",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      params: { tabId: "tab-42", url: "https://www.google.com/" }
    });

    await router(command);

    expect(observed).toEqual({ tabId: "tab-42", url: "https://www.google.com/" });
  });

  it("forwards typed scroll params as numbers", async () => {
    let observed: { tabId: string; x: number; y: number } | undefined;
    const router = createCommandRouter({
      scroll: async (tabId: string, x: number, y: number) => {
        observed = { tabId, x, y };
      }
    } as never);

    const command = bridgeCommandSchema.parse({
      type: "scroll",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      params: { tabId: "tab-42", x: 12, y: 345 }
    });

    await router(command);

    expect(observed).toEqual({ tabId: "tab-42", x: 12, y: 345 });
  });

  it("narrows BridgeCommand union through a typed switch", () => {
    const command: BridgeCommand = bridgeCommandSchema.parse({
      type: "finalize",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      params: { keep: [] }
    });

    if (command.type !== "finalize") {
      throw new Error("expected finalize command");
    }

    expect(command.params.keep).toEqual([]);
  });
});
