import type {
  BrowserConnector,
  BridgeTab,
  DomSnapshotResult,
  FinalizeRequest,
  ReadPageResult,
  ScrollResult
} from "./connector.js";

export class FakeConnector implements BrowserConnector {
  readonly capabilities = {
    canReadBackgroundTab: true,
    canInteractBackgroundTab: true,
    requiresForegroundForInput: false
  };

  private readonly tabs = new Map<string, BridgeTab>();
  private readonly sessions = new Map<string, { clientId: string; name?: string; tabIds: Set<string> }>();
  private activeSessionId?: string;
  private nextId = 1;

  getConnectionStatus() {
    const sessionId = this.activeSessionId;
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    return {
      connected: true,
      clientLabel: "Fake UMB connector",
      sessionActive: this.sessions.size > 0,
      sessionId,
      sessionName: session?.name,
      attachedTabCount: session?.tabIds.size ?? 0,
      connectedProcessLabel: "fake-connector"
    };
  }

  async getLiveConnectionStatus() {
    return this.getConnectionStatus();
  }

  async beginSession(session: {
    sessionId: string;
    clientId: string;
    name?: string;
  }): Promise<void> {
    this.sessions.set(session.sessionId, {
      clientId: session.clientId,
      name: session.name,
      tabIds: new Set<string>()
    });
    this.activeSessionId = session.sessionId;
  }

  async updateSession(session: {
    sessionId: string;
    name?: string;
  }): Promise<void> {
    const existing = this.sessions.get(session.sessionId);
    if (!existing) {
      throw new Error(`Unknown session: ${session.sessionId}`);
    }

    existing.name = session.name;
    this.activeSessionId = session.sessionId;
  }

  async endSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = [...this.sessions.keys()].at(-1);
    }
  }

  private getActiveSession() {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
  }

  async openTabs(): Promise<BridgeTab[]> {
    return [...this.tabs.values()];
  }

  async claimTab(tabId: string): Promise<BridgeTab> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Unknown tab: ${tabId}`);
    }

    tab.kind = "claimed";
    this.getActiveSession()?.tabIds.add(tabId);
    return tab;
  }

  async newTab(url?: string): Promise<BridgeTab> {
    const id = String(this.nextId++);
    const targetUrl = url ?? "about:blank";
    const tab: BridgeTab = {
      id,
      title:
        targetUrl === "about:blank"
          ? "New Tab"
          : targetUrl === "https://www.google.com/"
            ? "Google"
            : new URL(targetUrl).host,
      url: targetUrl,
      active: false,
      kind: "temporary",
      tabGroup: "UMB"
    };
    this.tabs.set(id, tab);
    this.getActiveSession()?.tabIds.add(id);
    return tab;
  }

  async goto(tabId: string, url: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Unknown tab: ${tabId}`);
    }

    tab.url = url;
    tab.title = url === "https://www.google.com/" ? "Google" : new URL(url).host;
  }

  async getUrl(tabId: string): Promise<string | undefined> {
    return this.tabs.get(tabId)?.url;
  }

  async getTitle(tabId: string): Promise<string | undefined> {
    return this.tabs.get(tabId)?.title;
  }

  async readPage(tabId: string, options: { format: "markdown" | "text"; maxChars?: number; includeMetadata: boolean }): Promise<ReadPageResult> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Unknown tab: ${tabId}`);
    }

    const content = `${tab.title ?? "Untitled"} ${tab.url ?? ""}`.trim();
    const limited = options.maxChars && content.length > options.maxChars
      ? content.slice(0, options.maxChars)
      : content;
    return {
      version: "1.0",
      url: tab.url ?? "",
      content: limited,
      contentType: options.format === "markdown" ? "text/markdown" : "text/plain",
      truncated: limited.length !== content.length,
      redacted: false,
      extraction: "fallback",
      totalControls: 0,
      controlsTruncated: false,
      controls: [],
      ...(options.includeMetadata ? { metadata: { title: tab.title ?? "" } } : {})
    };
  }

  async findControls(tabId: string, options: { query?: string; kind?: "link" | "button" | "input" | "textarea" | "select" | "form" | "contenteditable"; visibleOnly: boolean; limit: number }): Promise<{ totalControls: number; controlsTruncated: boolean; controls: [] }> {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Unknown tab: ${tabId}`);
    }
    void options;
    return { totalControls: 0, controlsTruncated: false, controls: [] };
  }

  async domSnapshot(tabId: string): Promise<DomSnapshotResult> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Unknown tab: ${tabId}`);
    }

    return {
      url: tab.url,
      title: tab.title,
      text: `${tab.title ?? "Untitled"} ${tab.url ?? ""}`.trim()
    };
  }

  async click(tabId: string, selector: string): Promise<void> {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Unknown tab: ${tabId}`);
    }
    void selector;
  }

  async fill(tabId: string, selector: string, value: string): Promise<void> {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Unknown tab: ${tabId}`);
    }
    void selector;
    void value;
  }

  async submit(tabId: string, selector: string): Promise<{ confirmed: boolean }> {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Unknown tab: ${tabId}`);
    }
    void selector;
    return { confirmed: true };
  }

  async scroll(tabId: string, x: number, y: number): Promise<ScrollResult> {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Unknown tab: ${tabId}`);
    }
    return { x, y };
  }

  async screenshot(tabId: string): Promise<string> {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Unknown tab: ${tabId}`);
    }
    return "data:image/png;base64,ZmFrZQ==";
  }

  async finalize(request: FinalizeRequest): Promise<{
    kept: FinalizeRequest["keep"];
    closed: string[];
    released: string[];
  }> {
    const keepIds = new Set(request.keep.map((item) => item.id));
    const ownedTabIds = new Set(request.ownedTabIds);
    const closed: string[] = [];
    const released: string[] = [];

    for (const tab of this.tabs.values()) {
      if (!ownedTabIds.has(tab.id)) {
        continue;
      }

      if (!keepIds.has(tab.id) && tab.kind === "temporary") {
        closed.push(tab.id);
      } else if (!keepIds.has(tab.id)) {
        released.push(tab.id);
      }
    }

    for (const id of closed) {
      this.tabs.delete(id);
    }

    await this.endSession(request.sessionId);

    return {
      kept: request.keep,
      closed,
      released
    };
  }
}
