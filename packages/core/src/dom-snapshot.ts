import type { BrowserConnector, DomSnapshotResult } from "./connector.js";

export async function readDomSnapshot(
  connector: BrowserConnector,
  tabId: string
): Promise<DomSnapshotResult> {
  return connector.domSnapshot(tabId);
}
