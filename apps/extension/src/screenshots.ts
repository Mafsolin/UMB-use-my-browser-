import { ensureControlledTab, runDebuggerCommand } from "./debugger.js";
import { redactionCss, REDACTION_STYLE_ID } from "./redaction.js";

export async function screenshot(sessionId: string, tabId: number): Promise<string> {
  await ensureControlledTab(sessionId, tabId);
  await applyScreenshotMasking(tabId);
  try {
    const result = await runDebuggerCommand<{ data: string }>(
      tabId,
      "Page.captureScreenshot",
      { format: "png" },
      "screenshot"
    );
    return `data:image/png;base64,${result.data}`;
  } finally {
    await removeScreenshotMasking(tabId);
  }
}

async function applyScreenshotMasking(tabId: number): Promise<void> {
  const css = redactionCss();
  const escaped = css.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
  const expression = `(() => {
    const existing = document.getElementById(${JSON.stringify(REDACTION_STYLE_ID)});
    if (existing) {
      existing.parentNode?.removeChild(existing);
    }
    const style = document.createElement('style');
    style.id = ${JSON.stringify(REDACTION_STYLE_ID)};
    style.textContent = '${escaped}';
    (document.head || document.documentElement).appendChild(style);
    return true;
  })()`;
  await runDebuggerCommand(
    tabId,
    "Runtime.evaluate",
    { expression, returnByValue: true },
    "evaluate"
  );
}

async function removeScreenshotMasking(tabId: number): Promise<void> {
  const expression = `(() => {
    const existing = document.getElementById(${JSON.stringify(REDACTION_STYLE_ID)});
    if (existing) {
      existing.parentNode?.removeChild(existing);
    }
    return true;
  })()`;
  await runDebuggerCommand(
    tabId,
    "Runtime.evaluate",
    { expression, returnByValue: true },
    "evaluate"
  ).catch(() => undefined);
}

