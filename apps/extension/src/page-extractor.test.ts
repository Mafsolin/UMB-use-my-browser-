// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  extractReadPage,
  findReadPageControls,
  FIND_CONTROLS_DEFAULT_LIMIT,
  READ_PAGE_DEFAULT_CONTROL_LIMIT,
  READ_PAGE_MAX_INPUT_CHARS,
  READ_PAGE_MAX_OUTPUT_CHARS,
  READ_PAGE_VERSION
} from "./page-extractor.js";
import { REDACTION_MASK } from "./redaction.js";

const url = "https://example.test/article";

function page(documentHtml: string) {
  return { url, title: "Fallback title", documentHtml };
}

describe("extractReadPage", () => {
  it("uses the worker-compatible fallback and produces GFM Markdown", () => {
    const result = extractReadPage(page(`
      <html><head><title>Readable article</title></head><body>
        <article><h1>Readable article</h1><p>Intro paragraph.</p>
        <ul><li>One</li><li>Two</li></ul>
        <table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>UMB</td></tr></tbody></table>
        </article>
      </body></html>`));

    expect(result).toMatchObject({
      version: READ_PAGE_VERSION,
      url,
      contentType: "text/markdown",
      extraction: "fallback",
      truncated: false,
      redacted: false,
      metadata: { title: "Fallback title" }
    });
    expect(result.content).toContain("Intro paragraph.");
    expect(result.content).toContain("- One");
    expect(result.content).toContain("| Name |");
  });

  it("falls back when Readability has no article", () => {
    const result = extractReadPage(page("<html><body></body></html>"));

    expect(result.extraction).toBe("fallback");
    expect(result.metadata?.title).toBe("Fallback title");
    expect(result.content).toBe("");
  });

  it("honors plain-text and metadata controls", () => {
    const result = extractReadPage(
      page("<html><body><article><h1>Heading</h1><p>Useful text.</p></article></body></html>"),
      { format: "text", includeMetadata: false }
    );

    expect(result.contentType).toBe("text/plain");
    expect(result.content).toContain("Heading Useful text.");
    expect(result.metadata).toBeUndefined();
  });

  it("collects actionable controls without exposing form values", () => {
    const result = extractReadPage(page(`
      <html><body><article><p>Controls</p></article>
        <a id="profile" href="/profiles/me">My profile</a>
        <a href="javascript:alert(1)">Unsafe link</a>
        <button aria-label="Save changes">Save</button>
        <label for="email">Email address</label><input id="email" value="person@example.test" />
        <textarea placeholder="Write a comment">private draft</textarea>
        <select title="Plan"><option value="pro" selected>Pro</option></select>
        <form id="signup"><input name="token" value="secret-token" /></form>
        <div contenteditable="true">Editable note</div>
        <button hidden>Hidden</button>
        <input disabled aria-label="Disabled input" />
      </body></html>`));

    expect(result.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "link",
        selector: "#profile",
        label: "My profile",
        href: "https://example.test/profiles/me",
        visible: true,
        actionable: true
      }),
      expect.objectContaining({ type: "link", label: "Unsafe link", visible: true, actionable: false }),
      expect.objectContaining({ type: "button", label: "Save changes", visible: true, actionable: true }),
      expect.objectContaining({ type: "input", selector: "#email", label: "Email address", actionable: true }),
      expect.objectContaining({ type: "textarea", label: "Write a comment", actionable: true }),
      expect.objectContaining({ type: "select", label: "Plan", actionable: true }),
      expect.objectContaining({ type: "form", selector: "#signup", actionable: true }),
      expect.objectContaining({ type: "contenteditable", label: "Editable note", actionable: true }),
      expect.objectContaining({ type: "button", label: "Hidden", visible: false, actionable: false }),
      expect.objectContaining({ type: "input", label: "Disabled input", visible: true, actionable: false })
    ]));
    expect(JSON.stringify(result.controls)).not.toContain("person@example.test");
    expect(JSON.stringify(result.controls)).not.toContain("private draft");
    expect(JSON.stringify(result.controls)).not.toContain("secret-token");
    expect(result.controls.find((control) => control.label === "Unsafe link")?.href).toBeUndefined();
  });

  it("caps read_page controls and reports totals", () => {
    const controls = Array.from({ length: READ_PAGE_DEFAULT_CONTROL_LIMIT + 1 }, (_, index) =>
      `<button aria-label="Action ${index}">Action ${index}</button>`
    ).join("");
    const result = extractReadPage(page(`<html><body>${controls}</body></html>`));

    expect(result.totalControls).toBe(READ_PAGE_DEFAULT_CONTROL_LIMIT + 1);
    expect(result.controlsTruncated).toBe(true);
    expect(result.controls).toHaveLength(READ_PAGE_DEFAULT_CONTROL_LIMIT);
  });

  it("finds controls across the uncapped control collection", () => {
    const controls = Array.from({ length: READ_PAGE_DEFAULT_CONTROL_LIMIT + 1 }, (_, index) =>
      `<button aria-label="Action ${index}">Action ${index}</button>`
    ).join("");
    const result = findReadPageControls(
      page(`<html><body>${controls}</body></html>`),
      { query: "Action 100", kind: "button" }
    );

    expect(result.totalControls).toBe(1);
    expect(result.controlsTruncated).toBe(false);
    expect(result.controls).toEqual([
      expect.objectContaining({ type: "button", label: "Action 100", visible: true, actionable: true })
    ]);
  });

  it("filters hidden controls by default and limits results", () => {
    const result = findReadPageControls(page(`
      <html><body>
        <button aria-label="Save">Save</button>
        <button aria-label="Save hidden" hidden>Save hidden</button>
      </body></html>`),
      { query: "save", limit: 1 }
    );

    expect(result).toMatchObject({ totalControls: 1, controlsTruncated: false });
    expect(result.controls).toHaveLength(1);
    expect(FIND_CONTROLS_DEFAULT_LIMIT).toBe(50);
  });

  it("redacts sensitive values before extraction", () => {
    const result = extractReadPage(page(`
      <html><body><article><h1>Private</h1>
        <p data-sensitive>super-secret-token</p>
        <input type="password" value="hunter2" />
        <p>Do not repeat super-secret-token or hunter2.</p>
      </article></body></html>`));

    expect(result.redacted).toBe(true);
    expect(result.content).toContain(REDACTION_MASK);
    expect(result.content).not.toContain("super-secret-token");
    expect(result.content).not.toContain("hunter2");
  });

  it("enforces input and output limits and signals truncation", () => {
    const inputLimited = extractReadPage(
      page(`<html><body>${"x".repeat(200)}</body></html>`),
      { maxInputChars: 40 }
    );
    expect(inputLimited.truncated).toBe(true);

    const outputLimited = extractReadPage(
      page(`<html><body><article><p>${"word ".repeat(200)}</p></article></body></html>`),
      { maxChars: 32 }
    );
    expect(outputLimited.content.length).toBe(32);
    expect(outputLimited.truncated).toBe(true);
  });

  it("exports conservative default limits", () => {
    expect(READ_PAGE_MAX_INPUT_CHARS).toBe(1_000_000);
    expect(READ_PAGE_MAX_OUTPUT_CHARS).toBe(100_000);
  });
});
