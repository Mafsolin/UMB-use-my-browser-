import { createWindow } from "@mixmark-io/domino";
import { redactDocumentHtml, redactText } from "./redaction.js";

export const READ_PAGE_VERSION = "1.0";
export const READ_PAGE_MAX_INPUT_CHARS = 1_000_000;
export const READ_PAGE_MAX_OUTPUT_CHARS = 100_000;
export const READ_PAGE_DEFAULT_CONTROL_LIMIT = 100;
export const FIND_CONTROLS_DEFAULT_LIMIT = 50;
export const FIND_CONTROLS_MAX_LIMIT = 100;

export type ReadPageFormat = "markdown" | "text";

export type ReadPageOptions = {
  format?: ReadPageFormat;
  maxChars?: number;
  includeMetadata?: boolean;
  maxInputChars?: number;
};

export type ReadPageMetadata = {
  title: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
};

export type ReadPageControlType =
  | "link"
  | "button"
  | "input"
  | "textarea"
  | "select"
  | "form"
  | "contenteditable";

export type ReadPageControl = {
  type: ReadPageControlType;
  selector: string;
  label?: string;
  href?: string;
  visible: boolean;
  actionable: boolean;
};

export type ReadPageResult = {
  version: typeof READ_PAGE_VERSION;
  url: string;
  content: string;
  contentType: "text/markdown" | "text/plain";
  truncated: boolean;
  redacted: boolean;
  extraction: "fallback";
  metadata?: ReadPageMetadata;
  totalControls: number;
  controlsTruncated: boolean;
  controls: ReadPageControl[];
};

export type FindControlsOptions = {
  query?: string;
  kind?: ReadPageControlType;
  visibleOnly?: boolean;
  limit?: number;
};

export type FindControlsResult = {
  totalControls: number;
  controlsTruncated: boolean;
  controls: ReadPageControl[];
};

type RawPage = {
  url: string;
  title: string;
  documentHtml: string;
  redacted?: boolean;
};

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }
  return Math.max(1, Math.min(READ_PAGE_MAX_OUTPUT_CHARS, Math.floor(value)));
}

function truncate(value: string, maxChars: number): { value: string; truncated: boolean } {
  return value.length > maxChars
    ? { value: value.slice(0, maxChars), truncated: true }
    : { value, truncated: false };
}

function parseDocument(html: string, url?: string): Document {
  return createWindow(html, url).document;
}

function normalizedText(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, 200) : undefined;
}

function textOf(element: Element): string {
  return element.textContent?.replace(/\s+/gu, " ").trim() ?? "";
}

function markdownFor(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const directChildren = Array.from(element.children);
  const text = textOf(element);

  if (!text) {
    return "";
  }
  if (/^h[1-6]$/u.test(tag)) {
    return `${"#".repeat(Number(tag[1]))} ${text}`;
  }
  if (tag === "pre") {
    return `\`\`\`\n${element.textContent?.trim() ?? ""}\n\`\`\``;
  }
  if (tag === "ul" || tag === "ol") {
    return Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((item, index) => `${tag === "ol" ? `${index + 1}.` : "-"} ${textOf(item)}`)
      .join("\n");
  }
  if (tag === "table") {
    const rows = Array.from(element.querySelectorAll("tr"));
    return rows.map((row) => `| ${Array.from(row.querySelectorAll("th, td")).map(textOf).join(" | ")} |`).join("\n");
  }
  if (["article", "main", "section", "div", "body"].includes(tag) && directChildren.length > 0) {
    const blocks = directChildren.map(markdownFor).filter(Boolean);
    return blocks.length > 0 ? blocks.join("\n\n") : text;
  }
  return text;
}

function fallbackContent(doc: Document): string {
  const clone = doc.body.cloneNode(true) as HTMLElement;
  for (const selector of ["script", "style", "noscript", "template", "iframe", "object", "embed", "form", "nav", "footer", "aside"]) {
    Array.from(clone.querySelectorAll(selector)).forEach((element) => element.remove());
  }
  return markdownFor(clone);
}

function plainText(markdown: string): string {
  return markdown.replace(/[>#|`]/gu, " ").replace(/\s+/gu, " ").trim();
}

const CONTROL_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "form",
  "[contenteditable]:not([contenteditable='false'])"
].join(", ");

function selectorFor(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const doc = element.ownerDocument;
  const uniqueAttributeSelector = (attribute: string): string | undefined => {
    const value = element.getAttribute(attribute);
    if (!value) return undefined;
    const selector = `${tag}[${attribute}=${JSON.stringify(value)}]`;
    try {
      return doc.querySelectorAll(selector).length === 1 ? selector : undefined;
    } catch {
      return undefined;
    }
  };
  const id = element.getAttribute("id");
  if (id && /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(id)) {
    return `#${id}`;
  }
  for (const attribute of ["data-testid", "data-test", "name", "aria-label", "role"]) {
    const selector = uniqueAttributeSelector(attribute);
    if (selector) return selector;
  }
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current.tagName.toLowerCase() !== "html") {
    const siblings = Array.from(current.parentElement?.children ?? []).filter((sibling) => sibling.tagName === current?.tagName);
    segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`);
    current = current.parentElement;
  }
  return `html > ${segments.join(" > ")}`;
}

function isVisible(element: Element): boolean {
  if (element.matches("input[type='hidden']")) return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = current.getAttribute("style") ?? "";
    if (
      current.hasAttribute("hidden") ||
      current.getAttribute("aria-hidden") === "true" ||
      /display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden/iu.test(style) ||
      /opacity\s*:\s*0(?:\s*;|\s*$)/iu.test(style)
    ) return false;
  }
  return true;
}

function sanitizedHref(rawHref: string, baseUrl: string): string | undefined {
  try {
    const href = new URL(rawHref, baseUrl);
    if (!["http:", "https:", "mailto:", "tel:"].includes(href.protocol)) return undefined;
    href.username = "";
    href.password = "";
    return href.toString();
  } catch {
    return undefined;
  }
}

function referencedText(element: Element, attribute: "aria-labelledby" | "aria-describedby"): string | undefined {
  const ids = (element.getAttribute(attribute) ?? "").trim().split(/\s+/u).filter(Boolean);
  if (ids.length === 0) return undefined;
  return normalizedText(ids.map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "").join(" "));
}

function controlLabel(element: Element): string | undefined {
  const aria = normalizedText(element.getAttribute("aria-label"));
  if (aria) return aria;
  const labelledBy = referencedText(element, "aria-labelledby");
  if (labelledBy) return labelledBy;
  const id = element.getAttribute("id");
  const label = id ? Array.from(element.ownerDocument.querySelectorAll("label")).find((item) => item.htmlFor === id) : undefined;
  const candidates = [
    label?.textContent,
    element.closest("label")?.textContent,
    element.getAttribute("title"),
    element.getAttribute("placeholder"),
    element.textContent,
    referencedText(element, "aria-describedby")
  ];
  return candidates.map(normalizedText).find((value): value is string => Boolean(value));
}

function extractControls(doc: Document, baseUrl: string, maskedValues: string[]): ReadPageControl[] {
  return Array.from(doc.querySelectorAll(CONTROL_SELECTOR)).map((element) => {
    const type: ReadPageControlType = element.matches("a[href]") ? "link" : element.matches("button") ? "button" : element.matches("textarea") ? "textarea" : element.matches("select") ? "select" : element.matches("form") ? "form" : element.matches("input") ? "input" : "contenteditable";
    const visible = isVisible(element);
    const href = type === "link" ? sanitizedHref(element.getAttribute("href") ?? "", baseUrl) : undefined;
    const label = redactText(controlLabel(element) ?? "", maskedValues) || undefined;
    const disabled = element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
    const inert = Boolean(element.closest("[inert]"));
    const actionable = visible && !disabled && !inert && (type !== "link" || Boolean(href));
    return { type, selector: selectorFor(element), ...(label ? { label } : {}), ...(href ? { href } : {}), visible, actionable };
  });
}

function clampControlLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }
  return Math.max(1, Math.min(FIND_CONTROLS_MAX_LIMIT, Math.floor(value)));
}

function limitControls(controls: ReadPageControl[], limit: number): FindControlsResult {
  return {
    totalControls: controls.length,
    controlsTruncated: controls.length > limit,
    controls: controls.slice(0, limit)
  };
}

export function findReadPageControls(
  raw: RawPage,
  options: FindControlsOptions = {}
): FindControlsResult {
  const input = truncate(raw.documentHtml, READ_PAGE_MAX_INPUT_CHARS);
  const redacted = redactDocumentHtml(input.value);
  const controls = extractControls(parseDocument(redacted.html, raw.url), raw.url, redacted.maskedValues);
  const query = options.query?.trim().toLocaleLowerCase();
  const visibleOnly = options.visibleOnly ?? true;
  const filtered = controls.filter((control) => {
    if (visibleOnly && !control.visible) return false;
    if (options.kind && control.type !== options.kind) return false;
    if (!query) return true;
    return [control.type, control.label, control.href]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(query));
  });
  return limitControls(filtered, clampControlLimit(options.limit, FIND_CONTROLS_DEFAULT_LIMIT));
}

export function extractReadPage(raw: RawPage, options: ReadPageOptions = {}): ReadPageResult {
  const input = truncate(raw.documentHtml, clampLimit(options.maxInputChars, READ_PAGE_MAX_INPUT_CHARS));
  const redacted = redactDocumentHtml(input.value);
  const doc = parseDocument(redacted.html, raw.url);
  const markdown = redactText(fallbackContent(doc), redacted.maskedValues);
  const format = options.format ?? "markdown";
  const output = truncate(format === "markdown" ? markdown : plainText(markdown), clampLimit(options.maxChars, READ_PAGE_MAX_OUTPUT_CHARS));
  const controls = extractControls(doc, raw.url, redacted.maskedValues);
  const limitedControls = limitControls(controls, READ_PAGE_DEFAULT_CONTROL_LIMIT);
  return {
    version: READ_PAGE_VERSION,
    url: raw.url,
    content: output.value,
    contentType: format === "markdown" ? "text/markdown" : "text/plain",
    truncated: input.truncated || output.truncated,
    redacted: Boolean(raw.redacted || redacted.maskedValues.length),
    extraction: "fallback",
    totalControls: limitedControls.totalControls,
    controlsTruncated: limitedControls.controlsTruncated,
    controls: limitedControls.controls,
    ...(options.includeMetadata === false ? {} : { metadata: { title: raw.title || doc.title || "" } })
  };
}
