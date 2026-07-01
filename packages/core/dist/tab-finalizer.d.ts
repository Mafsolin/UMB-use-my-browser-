import type { BridgeTab } from "./connector.js";
export type FinalizeDecision = {
    keep: Array<{
        id: string;
        status: "deliverable" | "handoff";
    }>;
    close: string[];
    release: string[];
};
export declare function finalizeTabs(input: {
    tabs: Array<BridgeTab & {
        kind?: string;
    }>;
}): FinalizeDecision;
