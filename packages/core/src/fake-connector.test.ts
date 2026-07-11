import { describe, expect, it } from "vitest";
import { FakeConnector } from "./fake-connector.js";

describe("FakeConnector", () => {
  it("creates a tab at the supplied URL", async () => {
    const connector = new FakeConnector();
    const tab = await connector.newTab("https://www.google.com/");

    expect(tab).toMatchObject({ title: "Google", url: "https://www.google.com/" });
  });

  it("preserves blank-tab behavior when no URL is supplied", async () => {
    const connector = new FakeConnector();
    const tab = await connector.newTab();

    expect(tab).toMatchObject({ title: "New Tab", url: "about:blank" });
  });

  it("can create and navigate a tab", async () => {
    const connector = new FakeConnector();
    const tab = await connector.newTab();

    await connector.goto(tab.id, "https://www.google.com/");

    expect(await connector.getUrl(tab.id)).toBe("https://www.google.com/");
    expect(await connector.getTitle(tab.id)).toBe("Google");
  });
});
