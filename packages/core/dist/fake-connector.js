export class FakeConnector {
    capabilities = {
        canReadBackgroundTab: true,
        canInteractBackgroundTab: true,
        requiresForegroundForInput: false
    };
    tabs = new Map();
    sessions = new Map();
    activeSessionId;
    nextId = 1;
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
    async beginSession(session) {
        this.sessions.set(session.sessionId, {
            clientId: session.clientId,
            name: session.name,
            tabIds: new Set()
        });
        this.activeSessionId = session.sessionId;
    }
    async updateSession(session) {
        const existing = this.sessions.get(session.sessionId);
        if (!existing) {
            throw new Error(`Unknown session: ${session.sessionId}`);
        }
        existing.name = session.name;
        this.activeSessionId = session.sessionId;
    }
    async endSession(sessionId) {
        this.sessions.delete(sessionId);
        if (this.activeSessionId === sessionId) {
            this.activeSessionId = [...this.sessions.keys()].at(-1);
        }
    }
    getActiveSession() {
        return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
    }
    async openTabs() {
        return [...this.tabs.values()];
    }
    async claimTab(tabId) {
        const tab = this.tabs.get(tabId);
        if (!tab) {
            throw new Error(`Unknown tab: ${tabId}`);
        }
        tab.kind = "claimed";
        this.getActiveSession()?.tabIds.add(tabId);
        return tab;
    }
    async newTab() {
        const id = String(this.nextId++);
        const tab = {
            id,
            title: "New Tab",
            url: "about:blank",
            active: false,
            kind: "temporary",
            tabGroup: "UMB"
        };
        this.tabs.set(id, tab);
        this.getActiveSession()?.tabIds.add(id);
        return tab;
    }
    async goto(tabId, url) {
        const tab = this.tabs.get(tabId);
        if (!tab) {
            throw new Error(`Unknown tab: ${tabId}`);
        }
        tab.url = url;
        tab.title = url === "https://www.google.com/" ? "Google" : new URL(url).host;
    }
    async getUrl(tabId) {
        return this.tabs.get(tabId)?.url;
    }
    async getTitle(tabId) {
        return this.tabs.get(tabId)?.title;
    }
    async domSnapshot(tabId) {
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
    async click(tabId, selector) {
        if (!this.tabs.has(tabId)) {
            throw new Error(`Unknown tab: ${tabId}`);
        }
        void selector;
    }
    async fill(tabId, selector, value) {
        if (!this.tabs.has(tabId)) {
            throw new Error(`Unknown tab: ${tabId}`);
        }
        void selector;
        void value;
    }
    async scroll(tabId, x, y) {
        if (!this.tabs.has(tabId)) {
            throw new Error(`Unknown tab: ${tabId}`);
        }
        return { x, y };
    }
    async screenshot(tabId) {
        if (!this.tabs.has(tabId)) {
            throw new Error(`Unknown tab: ${tabId}`);
        }
        return "data:image/png;base64,ZmFrZQ==";
    }
    async finalize(request) {
        const keepIds = new Set(request.keep.map((item) => item.id));
        const ownedTabIds = new Set(request.ownedTabIds);
        const closed = [];
        const released = [];
        for (const tab of this.tabs.values()) {
            if (!ownedTabIds.has(tab.id)) {
                continue;
            }
            if (!keepIds.has(tab.id) && tab.kind === "temporary") {
                closed.push(tab.id);
            }
            else if (!keepIds.has(tab.id)) {
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
