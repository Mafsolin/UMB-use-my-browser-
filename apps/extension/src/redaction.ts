export const REDACTION_MASK = "[UMB REDACTED]";

export const REDACTION_STYLE_ID = "umb-redaction-style";

export type RedactionRule = {
  selector: string;
  description: string;
  appliesToValues: boolean;
  appliesToText: boolean;
};

export const redactionRules: RedactionRule[] = [
  {
    selector: "input[type='password']",
    description: "password input field",
    appliesToValues: true,
    appliesToText: true
  },
  {
    selector: "[autocomplete^='cc-']",
    description: "credit-card autocomplete input",
    appliesToValues: true,
    appliesToText: true
  },
  {
    selector: "[data-sensitive]",
    description: "element with data-sensitive attribute",
    appliesToValues: true,
    appliesToText: true
  }
];

export function redactionSelectors(): string[] {
  return redactionRules.map((rule) => rule.selector);
}

export function redactionCss(): string {
  return `${redactionRules
    .map((rule) => `${rule.selector} { visibility: hidden !important; }`)
    .join("\n")}\n`;
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (!v || seen.has(v)) {
      continue;
    }
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function redactText(text: string, maskedValues: string[]): string {
  if (!text) {
    return text;
  }
  let result = text;
  for (const value of maskedValues) {
    if (!value || value === REDACTION_MASK) {
      continue;
    }
    if (result.includes(value)) {
      result = result.split(value).join(REDACTION_MASK);
    }
  }
  return result;
}

export function redactDocumentHtml(html: string): {
  html: string;
  maskedValues: string[];
} {
  if (!html || typeof DOMParser === "undefined") {
    return { html, maskedValues: [] };
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const masked: string[] = [];

  for (const rule of redactionRules) {
    const nodes = Array.from(doc.querySelectorAll(rule.selector));
    for (const node of nodes) {
      if (rule.appliesToValues && node instanceof HTMLInputElement) {
        if (node.value && node.value !== REDACTION_MASK) {
          masked.push(node.value);
          node.value = REDACTION_MASK;
        }
        const attrValue = node.getAttribute("value");
        if (attrValue && attrValue !== REDACTION_MASK) {
          masked.push(attrValue);
          node.setAttribute("value", REDACTION_MASK);
        }
      }
      if (rule.appliesToText) {
        const text = node.textContent;
        if (text && text.trim() && text !== REDACTION_MASK) {
          masked.push(text);
          node.textContent = REDACTION_MASK;
        }
      }
    }
  }

  return { html: doc.documentElement.outerHTML, maskedValues: dedupe(masked) };
}

export function redactSnapshot(input: {
  documentHtml?: string;
  text?: string;
}): { documentHtml: string; text: string; maskedValues: string[] } {
  const documentHtml = input.documentHtml ?? "";
  const text = input.text ?? "";
  const { html, maskedValues } = redactDocumentHtml(documentHtml);
  return {
    documentHtml: html,
    text: redactText(text, maskedValues),
    maskedValues
  };
}
