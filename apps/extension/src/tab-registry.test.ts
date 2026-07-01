import { describe, expect, it } from "vitest";
import { TabRegistry } from "./tab-registry.js";

describe("TabRegistry", () => {
  it("tracks created and claimed tabs separately", () => {
    const registry = new TabRegistry();
    registry.markCreated(1, "session-a", "UMB");
    registry.markClaimed(2, "session-b");

    expect(registry.get(1)?.createdByUmb).toBe(true);
    expect(registry.get(2)?.claimed).toBe(true);
    expect(registry.get(1)?.tabGroup).toBe("UMB");
    expect(registry.get(2)?.sessionId).toBe("session-b");
  });

  it("stores kept status for finalize flows", () => {
    const registry = new TabRegistry();
    registry.markCreated(3, "session-a", "UMB");
    registry.markKeep(3, "deliverable");

    expect(registry.get(3)?.keptStatus).toBe("deliverable");
  });

  it("can filter tabs by session", () => {
    const registry = new TabRegistry();
    registry.markCreated(1, "session-a", "UMB");
    registry.markClaimed(2, "session-b");

    expect(registry.valuesForSession("session-a").map((entry) => entry.tabId)).toEqual([1]);
  });
});
