import { describe, expect, it } from "vitest";
import {
  collectFinalizeTabIds,
  filterAttachedTabIdsForSession,
  isBootstrapUrl,
  isCommittedNavigation,
  isUsableNavigationState
} from "./background-runtime-helpers.js";

describe("background runtime helpers", () => {
  it("recognizes bootstrap urls", () => {
    expect(isBootstrapUrl("about:blank")).toBe(true);
    expect(isBootstrapUrl("chrome://newtab/")).toBe(true);
    expect(isBootstrapUrl("https://www.google.com/")).toBe(false);
  });

  it("accepts usable navigation for live web pages", () => {
    expect(
      isUsableNavigationState(
        {
          href: "https://www.google.com/search?q=weather",
          readyState: "complete",
          title: "weather - Google Search",
          documentHtml: "<html><body>weather</body></html>"
        },
        "https://www.google.com/search?q=weather"
      )
    ).toBe(true);
  });

  it("accepts usable data navigation after leaving bootstrap", () => {
    const requestedUrl = "data:text/html,hello";
    expect(
      isCommittedNavigation(
        {
          href: requestedUrl,
          readyState: "interactive",
          documentHtml: "<html><body>hello</body></html>"
        },
        requestedUrl
      )
    ).toBe(true);

    expect(
      isUsableNavigationState(
        {
          href: requestedUrl,
          readyState: "interactive",
          title: "UMB Test",
          documentHtml: "<html><body>hello</body></html>"
        },
        requestedUrl
      )
    ).toBe(true);
  });

  it("collects finalize ids from all runtime sources without duplicates", () => {
    expect(
      collectFinalizeTabIds({
        ownedTabIds: ["10", "11", "11"],
        sessionTabIds: [11, 12],
        registryTabIds: [12, 13],
        attachedTabIds: [13, 14]
      })
    ).toEqual([10, 11, 12, 13, 14]);
  });

  it("filters attached tabs down to the current session ownership", () => {
    expect(
      filterAttachedTabIdsForSession({
        attachedTabIds: [21, 22, 23, 23],
        sessionTabIds: [21, 24],
        registryTabIds: [22, 25]
      })
    ).toEqual([21, 22]);
  });
});
