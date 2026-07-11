import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const packageRoot = resolve(import.meta.dirname, "..");
const policyFiles = [
  "SKILL.md",
  "agents/openai.yaml",
  "references/browser-capability-matrix.md",
  "references/browser-playbook.md"
];

test("skill documentation states the browser-only policy", () => {
  for (const file of policyFiles) {
    const text = readFileSync(resolve(packageRoot, file), "utf8");
    assert.match(text, /browser-only|browser only/i, `${file} must state the browser-only policy`);
    assert.match(text, /HTTP/i, `${file} must prohibit HTTP fallback`);
  }
});
