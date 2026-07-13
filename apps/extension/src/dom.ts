import { ensureControlledTab, runDebuggerCommand } from "./debugger.js";
import {
  extractReadPage,
  findReadPageControls,
  READ_PAGE_MAX_INPUT_CHARS,
  type FindControlsOptions,
  type FindControlsResult,
  type ReadPageOptions,
  type ReadPageResult
} from "./page-extractor.js";
import { REDACTION_MASK, redactionSelectors } from "./redaction.js";

export type DomSnapshotPayload = {
  url: string;
  title: string;
  documentHtml: string;
  text: string;
};

export type ScrollResult = { x: number; y: number };

export type ClickResult = { confirmed: boolean };
export type SubmitResult = { confirmed: boolean; kind: "form" | "control" };

type RedactedPageTransport = {
  url: string;
  title: string;
  documentHtml: string;
  documentHtmlTruncated: boolean;
};

const REDACTED_PAGE_EXPRESSION = `(() => {
  const clone = document.documentElement.cloneNode(true);
  for (const selector of ${JSON.stringify(redactionSelectors())}) {
    clone.querySelectorAll(selector).forEach((element) => {
      if (element instanceof HTMLInputElement) {
        element.value = ${JSON.stringify(REDACTION_MASK)};
        element.setAttribute("value", ${JSON.stringify(REDACTION_MASK)});
      }
      element.textContent = ${JSON.stringify(REDACTION_MASK)};
    });
  }
  const fullHtml = clone.outerHTML;
  return {
    url: location.href,
    title: document.title,
    documentHtml: fullHtml.slice(0, ${READ_PAGE_MAX_INPUT_CHARS}),
    documentHtmlTruncated: fullHtml.length > ${READ_PAGE_MAX_INPUT_CHARS}
  };
})()`;

async function readRedactedPageTransport(
  sessionId: string,
  tabId: number
): Promise<RedactedPageTransport> {
  return evaluateOnControlledTab<RedactedPageTransport>(
    sessionId,
    tabId,
    REDACTED_PAGE_EXPRESSION
  );
}

export async function evaluateOnControlledTab<T>(
  sessionId: string,
  tabId: number,
  expression: string,
  timeoutMs?: number
): Promise<T> {
  await ensureControlledTab(sessionId, tabId);
  const result = await runDebuggerCommand<{
    exceptionDetails?: {
      text?: string;
      exception?: { description?: string; value?: string };
      stackTrace?: { callFrames?: Array<{ functionName?: string; url?: string; lineNumber?: number; columnNumber?: number }> };
    };
    result: { value?: T };
  }>(
    tabId,
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true
    },
    "evaluate",
    timeoutMs
  );

  if (result.exceptionDetails) {
    // Exception descriptions, values, and stack frames originate in the controlled page.
    // Do not surface them through the bridge: they can contain page data or implementation details.
    throw new Error(`Page evaluation failed on tab ${tabId}.`);
  }

  return result.result.value as T;
}

export async function readPage(
  sessionId: string,
  tabId: number,
  options: ReadPageOptions
): Promise<ReadPageResult> {
  const raw = await readRedactedPageTransport(sessionId, tabId);
  const result = extractReadPage({ ...raw, redacted: true }, options);
  return raw.documentHtmlTruncated && !result.truncated
    ? { ...result, truncated: true }
    : result;
}

export async function findControls(
  sessionId: string,
  tabId: number,
  options: FindControlsOptions
): Promise<FindControlsResult> {
  const raw = await readRedactedPageTransport(sessionId, tabId);
  return findReadPageControls({ ...raw, redacted: true }, options);
}

export async function domSnapshot(sessionId: string, tabId: number): Promise<DomSnapshotPayload> {
  const raw = await evaluateOnControlledTab<{
    url: string;
    title: string;
    documentHtml: string;
    text: string;
  }>(
    sessionId,
    tabId,
    `(() => {
      const clone = document.documentElement.cloneNode(true);
      const maskedValues = [];
      for (const selector of ["input[type='password']", "[autocomplete^='cc-']", "[data-sensitive]"]) {
        clone.querySelectorAll(selector).forEach((element) => {
          if (element instanceof HTMLInputElement) {
            if (element.value) maskedValues.push(element.value);
            const attributeValue = element.getAttribute("value");
            if (attributeValue) maskedValues.push(attributeValue);
            element.value = "[UMB REDACTED]";
            element.setAttribute("value", "[UMB REDACTED]");
          }
          if (element.textContent) maskedValues.push(element.textContent);
          element.textContent = "[UMB REDACTED]";
        });
      }
      let text = document.body?.innerText ?? "";
      for (const value of [...new Set(maskedValues)]) {
        if (value) text = text.split(value).join("[UMB REDACTED]");
      }
      return {
        url: location.href,
        title: document.title,
        documentHtml: clone.outerHTML,
        text
      };
    })()`
  );
  return raw;
}

export async function click(
  sessionId: string,
  tabId: number,
  selector: string
): Promise<ClickResult> {
  return evaluateOnControlledTab(
    sessionId,
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Selector not found");
      if (!(el instanceof HTMLElement)) throw new Error("Target is not clickable");
      el.click();
      return { confirmed: true };
    })()`
  );
}

type FillTargetKind = "input" | "textarea" | "contenteditable";
type FillValidationCode = "selector-not-found" | "not-fillable" | "disabled" | "hidden" | "focus" | "update";
type FillPreflightResult =
  | { ok: true; kind: FillTargetKind }
  | { ok: false; code: FillValidationCode };

const fillValidationMessages: Record<FillValidationCode, string> = {
  "selector-not-found": "Fill target was not found.",
  "not-fillable": "Fill target is not fillable.",
  disabled: "Fill target is disabled or read-only.",
  hidden: "Fill target is hidden or has no layout.",
  focus: "Fill target could not receive focus.",
  update: "Fill target did not update."
};

function throwFillValidationError(code: FillValidationCode): never {
  throw new Error(`[UMB_FILL_${code.toUpperCase().replaceAll("-", "_")}] ${fillValidationMessages[code]}`);
}

export async function fill(
  sessionId: string,
  tabId: number,
  selector: string,
  value: string
): Promise<true> {
  const target = await evaluateOnControlledTab<FillPreflightResult>(
    sessionId,
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, code: "selector-not-found" };
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el.disabled || el.readOnly) return { ok: false, code: "disabled" };
        el.focus();
        if (document.activeElement !== el) return { ok: false, code: "focus" };
        const prototype = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) return { ok: false, code: "update" };
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(value)} }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === ${JSON.stringify(value)}
          ? { ok: true, kind: el instanceof HTMLInputElement ? "input" : "textarea" }
          : { ok: false, code: "update" };
      }
      if (!(el instanceof HTMLElement) || !el.isContentEditable) return { ok: false, code: "not-fillable" };
      // CDP has no standalone focus command. Runtime.evaluate executes focus in the
      // page's document, then Input.insertText uses Chrome's native focused target.
      if (!el.isConnected) return { ok: false, code: "not-fillable" };
      if (el.closest("[disabled], [aria-disabled='true'], [inert]")) {
        return { ok: false, code: "disabled" };
      }
      if (el.closest("[hidden], [aria-hidden='true']")) return { ok: false, code: "hidden" };
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.contentVisibility === "hidden" ||
        style.opacity === "0" ||
        rect.width <= 0 ||
        rect.height <= 0
      ) return { ok: false, code: "hidden" };
      el.focus();
      if (document.activeElement !== el) return { ok: false, code: "focus" };
      const selection = window.getSelection();
      if (!selection) return { ok: false, code: "focus" };
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      return { ok: true, kind: "contenteditable" };
    })()`
  );

  if (!target.ok) throwFillValidationError(target.code);
  if (target.kind !== "contenteditable") return true;

  await runDebuggerCommand(tabId, "Input.insertText", { text: value }, "evaluate");
  const update = await evaluateOnControlledTab<{ ok: true } | { ok: false; code: "update" | "not-fillable" }>(
    sessionId,
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!(el instanceof HTMLElement) || !el.isContentEditable) return { ok: false, code: "not-fillable" };
      const text = (el.innerText ?? el.textContent ?? "").replace(/\\r\\n?/gu, "\\n");
      return text === ${JSON.stringify(value)}
        ? { ok: true }
        : { ok: false, code: "update" };
    })()`
  );
  if (!update.ok) throwFillValidationError(update.code);
  return true;
}

export async function submit(
  sessionId: string,
  tabId: number,
  selector: string
): Promise<SubmitResult> {
  return evaluateOnControlledTab(
    sessionId,
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Selector not found");
      const isForm = el instanceof HTMLFormElement;
      const isSubmitControl = (el instanceof HTMLButtonElement && (el.type === 'submit' || el.type === ''))
        || (el instanceof HTMLInputElement && el.type === 'submit');
      if (!isForm && !isSubmitControl) {
        throw new Error("Target is not a form or submit control");
      }
      if (isForm) {
        if (typeof el.requestSubmit === 'function') {
          el.requestSubmit();
        } else {
          const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
          const shouldContinue = el.dispatchEvent(submitEvent);
          if (shouldContinue) {
            el.submit();
          }
        }
        return { confirmed: true, kind: 'form' };
      }
      el.click();
      return { confirmed: true, kind: 'control' };
    })()`
  );
}

export async function scroll(
  sessionId: string,
  tabId: number,
  x: number,
  y: number
): Promise<ScrollResult> {
  return evaluateOnControlledTab(
    sessionId,
    tabId,
    `(() => {
      window.scrollBy(${JSON.stringify(x)}, ${JSON.stringify(y)});
      return { x: window.scrollX, y: window.scrollY };
    })()`
  );
}
