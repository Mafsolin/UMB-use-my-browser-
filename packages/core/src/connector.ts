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

export type ReadPageOptions = {
  format: "markdown" | "text";
  maxChars?: number;
  includeMetadata: boolean;
};

export type ReadPageMetadata = {
  title: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
};

export type ReadPageControlType =
  | "link"
  | "button"
  | "input"
  | "textarea"
  | "select"
  | "form"
  | "contenteditable";

export type ReadPageControl = {
  type: ReadPageControlType;
  selector: string;
  label?: string;
  href?: string;
  visible: boolean;
  actionable: boolean;
};

export type ReadPageResult = {
  version: "1.0";
  url: string;
  content: string;
  contentType: "text/markdown" | "text/plain";
  truncated: boolean;
  redacted: boolean;
  extraction: "readability" | "fallback";
  metadata?: ReadPageMetadata;
  totalControls: number;
  controlsTruncated: boolean;
  controls: ReadPageControl[];
};

export type FindControlsOptions = {
  query?: string;
  kind?: ReadPageControlType;
  visibleOnly: boolean;
  limit: number;
};

export type FindControlsResult = {
  totalControls: number;
  controlsTruncated: boolean;
  controls: ReadPageControl[];
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
  newTab(url?: string): Promise<BridgeTab>;
  goto(tabId: string, url: string): Promise<void>;
  getUrl(tabId: string): Promise<string | undefined>;
  getTitle(tabId: string): Promise<string | undefined>;
  readPage(tabId: string, options: ReadPageOptions): Promise<ReadPageResult>;
  findControls(tabId: string, options: FindControlsOptions): Promise<FindControlsResult>;
  domSnapshot(tabId: string): Promise<DomSnapshotResult>;
  click(tabId: string, selector: string): Promise<void>;
  fill(tabId: string, selector: string, value: string): Promise<void>;
  scroll(tabId: string, x: number, y: number): Promise<ScrollResult>;
  screenshot(tabId: string): Promise<string>;
  submit(tabId: string, selector: string): Promise<{ confirmed: boolean }>;
  finalize(request: FinalizeRequest): Promise<{
    kept: FinalizeInstruction[];
    closed: string[];
    released: string[];
  }>;
}
