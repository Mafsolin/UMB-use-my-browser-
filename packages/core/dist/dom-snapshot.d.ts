import type { BrowserConnector, DomSnapshotResult } from "./connector.js";
export declare function readDomSnapshot(connector: BrowserConnector, tabId: string): Promise<DomSnapshotResult>;
