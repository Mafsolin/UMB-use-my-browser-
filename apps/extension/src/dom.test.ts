// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureControlledTab, runDebuggerCommand } = vi.hoisted(() => ({
  ensureControlledTab: vi.fn(),
  runDebuggerCommand: vi.fn()
}));

vi.mock("./debugger.js", () => ({ ensureControlledTab, runDebuggerCommand }));

import { evaluateOnControlledTab, fill, findControls, readPage } from "./dom.js";
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

describe("DOM fill", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 200, height: 40, top: 0, right: 200, bottom: 40, left: 0, x: 0, y: 0,
      toJSON: () => ({})
    });
    ensureControlledTab.mockReset().mockResolvedValue(undefined);
    runDebuggerCommand.mockReset().mockImplementation(async (
      _tabId: number,
      method: string,
      params: { expression?: string; text?: string }
    ) => {
      if (method === "Input.insertText") {
        const selection = document.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
        if (!range) throw new Error("Expected an active selection");
        range.deleteContents();
        range.insertNode(document.createTextNode(params.text ?? ""));
        return {};
      }
      return { result: { value: globalThis.eval(params.expression ?? "") } };
    });
  });

  it("fills contenteditable controls through CDP text insertion without sending", async () => {
    document.body.innerHTML = '<div id="editor" contenteditable="true">Old <strong>rich</strong> content</div>';
    await expect(fill("session", 7, "#editor", "New message")).resolves.toBe(true);

    expect(document.querySelector("#editor")?.textContent).toBe("New message");
    expect(runDebuggerCommand).toHaveBeenCalledWith(7, "Input.insertText", { text: "New message" }, "evaluate");
  });

  it("uses native setters and input/change events for input controls", async () => {
    document.body.innerHTML = '<input id="subject" value="old">';
    const input = document.querySelector("#subject") as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));

    await expect(fill("session", 7, "#subject", "New subject")).resolves.toBe(true);

    expect(input.value).toBe("New subject");
    expect(events).toEqual(["input", "change"]);
    expect(runDebuggerCommand).not.toHaveBeenCalledWith(7, "Input.insertText", expect.anything(), "evaluate");
  });

  it.each([
    ["disabled", '<div id="editor" contenteditable="true" disabled></div>', () => undefined, "UMB_FILL_DISABLED"],
    ["aria-disabled", '<div id="editor" contenteditable="true" aria-disabled="true"></div>', () => undefined, "UMB_FILL_DISABLED"],
    ["inert", '<div inert><div id="editor" contenteditable="true"></div></div>', () => undefined, "UMB_FILL_DISABLED"],
    ["hidden", '<div hidden><div id="editor" contenteditable="true"></div></div>', () => undefined, "UMB_FILL_HIDDEN"],
    ["zero-layout", '<div id="editor" contenteditable="true"></div>', (editor: HTMLElement) => vi.spyOn(editor, "getBoundingClientRect").mockReturnValue({ width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0, toJSON: () => ({}) }), "UMB_FILL_HIDDEN"]
  ])("returns a safe %s validation error before CDP text insertion", async (_reason, html, arrange, code) => {
    document.body.innerHTML = html;
    const editor = document.querySelector("#editor") as HTMLElement;
    arrange(editor);

    await expect(fill("session", 7, "#editor", "New message")).rejects.toThrow(code);
    expect(runDebuggerCommand).not.toHaveBeenCalledWith(7, "Input.insertText", expect.anything(), "evaluate");
  });

  it.each([
    ["#missing", '<div id="editor" contenteditable="true"></div>', "UMB_FILL_SELECTOR_NOT_FOUND"],
    ["#editor", '<div id="editor">Not editable</div>', "UMB_FILL_NOT_FILLABLE"]
  ])("returns safe codes for %s preflight failures", async (selector, html, code) => {
    document.body.innerHTML = html;

    await expect(fill("session", 7, selector, "New message")).rejects.toThrow(code);
  });

  it("returns a safe not-fillable code for disconnected contenteditable targets", async () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    vi.spyOn(document, "querySelector").mockReturnValue(editor);

    await expect(fill("session", 7, "#editor", "New message")).rejects.toThrow("UMB_FILL_NOT_FILLABLE");
    expect(runDebuggerCommand).not.toHaveBeenCalledWith(7, "Input.insertText", expect.anything(), "evaluate");
  });

  it("returns a safe focus code when a contenteditable target cannot receive focus", async () => {
    document.body.innerHTML = '<div id="editor" contenteditable="true"></div>';
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => undefined);

    await expect(fill("session", 7, "#editor", "New message")).rejects.toThrow("UMB_FILL_FOCUS");
    expect(runDebuggerCommand).not.toHaveBeenCalledWith(7, "Input.insertText", expect.anything(), "evaluate");
  });

  it("returns a safe update code when CDP insertion does not update a contenteditable target", async () => {
    document.body.innerHTML = '<div id="editor" contenteditable="true"></div>';
    runDebuggerCommand.mockImplementation(async (_tabId, method, params: { expression?: string }) => {
      if (method === "Input.insertText") return {};
      return { result: { value: globalThis.eval(params.expression ?? "") } };
    });

    await expect(fill("session", 7, "#editor", "New message")).rejects.toThrow("UMB_FILL_UPDATE");
  });

  it("returns a bounded generic error instead of page exception data", async () => {
    runDebuggerCommand.mockResolvedValueOnce({
      exceptionDetails: { text: "Uncaught private draft", exception: { description: "Error: secret page stack" } },
      result: {}
    });

    await expect(evaluateOnControlledTab("session", 7, "throw new Error()"))
      .rejects.toThrow("Page evaluation failed on tab 7.");
  });
});
