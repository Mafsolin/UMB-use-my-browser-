import type { CapabilityFlags } from "@umb/protocol";

export type BridgeTabKind =
  | "temporary"
  | "deliverable"
  | "handoff"
  | "claimed"
  | "user";

export type BridgeTab = {
  id: string;
  title?: string;
  url?: string;
  active?: boolean;
  kind?: BridgeTabKind;
  tabGroup?: string;
};

export type DomSnapshotResult = {
  url?: string;
  title?: string;
  documentHtml?: string;
  text?: string;
};

export type ScrollResult = {
  x: number;
  y: number;
};

export type FinalizeInstruction = {
  id: string;
  status: "deliverable" | "handoff";
};

export type FinalizeRequest = {
  sessionId: string;
  keep: FinalizeInstruction[];
  ownedTabIds: string[];
};

export interface BrowserConnector {
  readonly capabilities: CapabilityFlags;
  getConnectionStatus?(): {
    connected: boolean;
    lastConnectedAt?: string;
    clientLabel?: string;
    sessionActive?: boolean;
    sessionId?: string;
    sessionName?: string;
    attachedTabCount?: number;
    connectedProcessLabel?: string;
  };
  getLiveConnectionStatus?(): Promise<{
    connected: boolean;
    lastConnectedAt?: string;
    clientLabel?: string;
    sessionActive?: boolean;
    sessionId?: string;
    sessionName?: string;
    attachedTabCount?: number;
    connectedProcessLabel?: string;
  }>;
  beginSession?(session: {
    sessionId: string;
    clientId: string;
    name?: string;
  }): Promise<void>;
  updateSession?(session: {
    sessionId: string;
    name?: string;
  }): Promise<void>;
  endSession?(sessionId: string): Promise<void>;
  openTabs(): Promise<BridgeTab[]>;
  claimTab(tabId: string): Promise<BridgeTab>;
  newTab(): Promise<BridgeTab>;
  goto(tabId: string, url: string): Promise<void>;
  getUrl(tabId: string): Promise<string | undefined>;
  getTitle(tabId: string): Promise<string | undefined>;
  domSnapshot(tabId: string): Promise<DomSnapshotResult>;
  click(tabId: string, selector: string): Promise<void>;
  fill(tabId: string, selector: string, value: string): Promise<void>;
  scroll(tabId: string, x: number, y: number): Promise<ScrollResult>;
  screenshot(tabId: string): Promise<string>;
  finalize(request: FinalizeRequest): Promise<{
    kept: FinalizeInstruction[];
    closed: string[];
    released: string[];
  }>;
}
