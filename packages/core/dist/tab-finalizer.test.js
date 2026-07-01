import { describe, expect, it } from "vitest";
import { finalizeTabs } from "./tab-finalizer.js";
describe("finalizeTabs", () => {
    it("closes temporary tabs and preserves deliverables", () => {
        const result = finalizeTabs({
            tabs: [
                { id: "tmp-1", kind: "temporary" },
                { id: "deliver-1", kind: "deliverable" }
            ]
        });
        expect(result.close).toEqual(["tmp-1"]);
        expect(result.keep).toEqual([
            { id: "deliver-1", status: "deliverable" }
        ]);
    });
});
