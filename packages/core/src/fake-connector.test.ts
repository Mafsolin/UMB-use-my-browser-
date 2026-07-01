import { describe, expect, it } from "vitest";
import { FakeConnector } from "./fake-connector.js";

describe("FakeConnector", () => {
  it("can create and navigate a tab", async () => {
    const connector = new FakeConnector();
    const tab = await connector.newTab();

    await connector.goto(tab.id, "https://www.google.com/");

    expect(await connector.getUrl(tab.id)).toBe("https://www.google.com/");
    expect(await connector.getTitle(tab.id)).toBe("Google");
  });
});
