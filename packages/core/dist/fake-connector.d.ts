import type { BrowserConnector, BridgeTab, DomSnapshotResult, FinalizeRequest, ScrollResult } from "./connector.js";
export declare class FakeConnector implements BrowserConnector {
    readonly capabilities: {
        canReadBackgroundTab: boolean;
        canInteractBackgroundTab: boolean;
        requiresForegroundForInput: boolean;
    };
    private readonly tabs;
    private readonly sessions;
    private activeSessionId?;
    private nextId;
    getConnectionStatus(): {
        connected: boolean;
        clientLabel: string;
        sessionActive: boolean;
        sessionId: string | undefined;
        sessionName: string | undefined;
        attachedTabCount: number;
        connectedProcessLabel: string;
    };
    getLiveConnectionStatus(): Promise<{
        connected: boolean;
        clientLabel: string;
        sessionActive: boolean;
        sessionId: string | undefined;
        sessionName: string | undefined;
        attachedTabCount: number;
        connectedProcessLabel: string;
    }>;
    beginSession(session: {
        sessionId: string;
        clientId: string;
        name?: string;
    }): Promise<void>;
    updateSession(session: {
        sessionId: string;
        name?: string;
    }): Promise<void>;
    endSession(sessionId: string): Promise<void>;
    private getActiveSession;
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
        kept: FinalizeRequest["keep"];
        closed: string[];
        released: string[];
    }>;
}
