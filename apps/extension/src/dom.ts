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
    exceptionDetails?: { text?: string };
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
    throw new Error(result.exceptionDetails.text ?? `Debugger evaluation failed on tab ${tabId}.`);
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

export async function fill(
  sessionId: string,
  tabId: number,
  selector: string,
  value: string
): Promise<true> {
  return evaluateOnControlledTab(
    sessionId,
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Selector not found");
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        throw new Error("Target is not fillable");
      }
      el.focus();
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`
  );
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
