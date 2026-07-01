// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  REDACTION_MASK,
  redactionCss,
  redactionRules,
  redactionSelectors,
  redactDocumentHtml,
  redactSnapshot,
  redactText
} from "./redaction.js";

describe("redaction rules", () => {
  it("lists the canonical sensitive selectors", () => {
    expect(redactionSelectors()).toEqual([
      "input[type='password']",
      "[autocomplete^='cc-']",
      "[data-sensitive]"
    ]);
  });

  it("matches passwords, credit-card autocompletes, and data-sensitive elements", () => {
    const descriptions = redactionRules.map((rule) => rule.description);
    expect(descriptions).toContain("password input field");
    expect(descriptions).toContain("credit-card autocomplete input");
    expect(descriptions).toContain("element with data-sensitive attribute");
  });

  it("produces CSS that hides all sensitive selectors", () => {
    const css = redactionCss();
    expect(css).toContain("input[type='password']");
    expect(css).toContain("[autocomplete^='cc-']");
    expect(css).toContain("[data-sensitive]");
    expect(css).toContain("visibility: hidden");
  });
});

describe("redactText", () => {
  it("replaces every occurrence of a masked value", () => {
    const result = redactText("user hunter2 hunter2 left", ["hunter2"]);
    expect(result).toBe(`user ${REDACTION_MASK} ${REDACTION_MASK} left`);
  });

  it("skips empty or duplicate masked values", () => {
    expect(redactText("hello world", ["", "same", "same"])).toBe("hello world");
  });

  it("does not touch safe text", () => {
    expect(redactText("safe content here", [])).toBe("safe content here");
  });
});

describe("redactDocumentHtml", () => {
  it("masks a password input value", () => {
    const html = `<form><input type="password" name="pw" value="hunter2" /></form>`;
    const { html: out, maskedValues } = redactDocumentHtml(html);
    expect(maskedValues).toContain("hunter2");
    expect(out).toContain(`value="${REDACTION_MASK}"`);
    expect(out).not.toContain("hunter2");
  });

  it("masks credit-card autocomplete values", () => {
    const html = `<input type="text" autocomplete="cc-number" value="4111111111111111" />`;
    const { html: out, maskedValues } = redactDocumentHtml(html);
    expect(maskedValues).toContain("4111111111111111");
    expect(out).toContain(`value="${REDACTION_MASK}"`);
    expect(out).not.toContain("4111111111111111");
  });

  it("masks elements with the data-sensitive attribute", () => {
    const html = `<div data-sensitive>top-secret-token</div>`;
    const { html: out, maskedValues } = redactDocumentHtml(html);
    expect(maskedValues).toContain("top-secret-token");
    expect(out).toContain(REDACTION_MASK);
    expect(out).not.toContain("top-secret-token");
  });

  it("leaves safe elements untouched", () => {
    const html = `<p>Hello world</p><input type="text" value="visible" />`;
    const { html: out, maskedValues } = redactDocumentHtml(html);
    expect(maskedValues).toEqual([]);
    expect(out).toContain("Hello world");
    expect(out).toContain(`value="visible"`);
  });
});

describe("redactSnapshot", () => {
  it("returns masked documentHtml and scrubs the same values from the text", () => {
    const snapshot = redactSnapshot({
      documentHtml: `<form><input type="password" value="hunter2" /></form>`,
      text: "Logged in with hunter2 just now."
    });

    expect(snapshot.documentHtml).not.toContain("hunter2");
    expect(snapshot.text).toBe(`Logged in with ${REDACTION_MASK} just now.`);
    expect(snapshot.maskedValues).toEqual(["hunter2"]);
  });

  it("masks data-sensitive content in both the HTML and the rendered text", () => {
    const snapshot = redactSnapshot({
      documentHtml: `<div data-sensitive>super-secret</div>`,
      text: "Notes: super-secret"
    });

    expect(snapshot.documentHtml).not.toContain("super-secret");
    expect(snapshot.text).toBe(`Notes: ${REDACTION_MASK}`);
  });

  it("returns the original HTML and text when there is no documentHtml", () => {
    const snapshot = redactSnapshot({ text: "safe text" });
    expect(snapshot.documentHtml).toBe("");
    expect(snapshot.text).toBe("safe text");
    expect(snapshot.maskedValues).toEqual([]);
  });
});
