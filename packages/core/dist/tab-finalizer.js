export function finalizeTabs(input) {
    const keep = [];
    const close = [];
    const release = [];
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
