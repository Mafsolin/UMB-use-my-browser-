import type { BridgeTab } from "./connector.js";

export type FinalizeDecision = {
  keep: Array<{ id: string; status: "deliverable" | "handoff" }>;
  close: string[];
  release: string[];
};

export function finalizeTabs(input: {
  tabs: Array<BridgeTab & { kind?: string }>;
}): FinalizeDecision {
  const keep: FinalizeDecision["keep"] = [];
  const close: string[] = [];
  const release: string[] = [];

  for (const tab of input.tabs) {
    if (tab.kind === "deliverable") {
      keep.push({ id: tab.id, status: "deliverable" });
      continue;
    }

    if (tab.kind === "handoff") {
      keep.push({ id: tab.id, status: "handoff" });
      continue;
    }

    if (tab.kind === "claimed" || tab.kind === "user") {
      release.push(tab.id);
      continue;
    }

    close.push(tab.id);
  }

  return { keep, close, release };
}
