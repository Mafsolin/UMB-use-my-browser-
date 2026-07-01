export async function readDomSnapshot(connector, tabId) {
    return connector.domSnapshot(tabId);
}
