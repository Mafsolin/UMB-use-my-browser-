import { describe, expect, it, vi } from "vitest";

vi.mock("./tabs.js", () => ({
  claimTab: vi.fn(),
  getTitle: vi.fn(),
  getUrl: vi.fn(),
  goto: vi.fn(),
  nameSession: vi.fn(),
  newTab: vi.fn(),
  openTabs: vi.fn(),
  startSession: vi.fn(),
  tabIdFromString: vi.fn()
}));
vi.mock("./dom.js", () => ({
  click: vi.fn(),
  domSnapshot: vi.fn(),
  fill: vi.fn(),
  scroll: vi.fn(),
  submit: vi.fn()
}));
vi.mock("./screenshots.js", () => ({ screenshot: vi.fn() }));
vi.mock("./permissions.js", () => ({ finalize: vi.fn() }));
vi.mock("./status.js", () => ({
  getStatusResponse: vi.fn(),
  syncSessionStatus: vi.fn()
}));

import { handleRequest } from "./commands.js";

describe("handleRequest", () => {
  it("rejects an unknown extension command explicitly", async () => {
    await expect(
      handleRequest({ id: "request-1", type: "notACommand" } as never)
    ).rejects.toThrow("Unknown extension command: notACommand.");
  });
});
