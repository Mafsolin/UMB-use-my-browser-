// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureControlledTab, runDebuggerCommand } = vi.hoisted(() => ({
  ensureControlledTab: vi.fn(),
  runDebuggerCommand: vi.fn()
}));

vi.mock("./debugger.js", () => ({ ensureControlledTab, runDebuggerCommand }));

import { findControls, readPage } from "./dom.js";
import { READ_PAGE_MAX_INPUT_CHARS } from "./page-extractor.js";

interface EvaluatedPage {
  documentHtml: string;
  documentHtmlTruncated: boolean;
}

describe("redacted page transport", () => {
  const transportedPages: EvaluatedPage[] = [];

  beforeEach(() => {
    transportedPages.length = 0;
    ensureControlledTab.mockReset().mockResolvedValue(undefined);
    runDebuggerCommand.mockReset().mockImplementation(async (
      _tabId: number,
      method: string,
      params: { expression?: string }
    ) => {
      expect(method).toBe("Runtime.evaluate");
      const value = globalThis.eval(params.expression ?? "") as EvaluatedPage;
      transportedPages.push(value);
      return { result: { value } };
    });
  });

  it("caps already-redacted HTML at the extractor bound for readPage and findControls", async () => {
    const secret = "transport-secret-value";
    document.documentElement.innerHTML = `<head><title>Large page</title></head><body>
      <input type="password" value="${secret}">
      <p data-sensitive>${secret}</p>
      <main>Short public content</main>
      <!-- ${"x".repeat(READ_PAGE_MAX_INPUT_CHARS + 1_000)} -->
    </body>`;

    const readResult = await readPage("session", 7, { includeMetadata: false, maxChars: 100 });
    const controlsResult = await findControls("session", 7, { visibleOnly: true });

    expect(transportedPages).toHaveLength(2);
    for (const transported of transportedPages) {
      expect(transported.documentHtml).toHaveLength(READ_PAGE_MAX_INPUT_CHARS);
      expect(transported.documentHtmlTruncated).toBe(true);
      expect(transported.documentHtml).not.toContain(secret);
    }
    expect(readResult.truncated).toBe(true);
    expect(JSON.stringify(readResult)).not.toContain(secret);
    expect(JSON.stringify(controlsResult)).not.toContain(secret);
    expect(controlsResult).not.toHaveProperty("documentHtmlTruncated");
  });
});
