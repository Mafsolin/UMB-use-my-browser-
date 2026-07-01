export class TabSessionRegistry {
  private readonly sessionTabs = new Map<string, Set<string>>();

  track(sessionId: string, tabId: string): void {
    const tabs = this.sessionTabs.get(sessionId) ?? new Set<string>();
    tabs.add(tabId);
    this.sessionTabs.set(sessionId, tabs);
  }

  isTracked(sessionId: string, tabId: string): boolean {
    return this.sessionTabs.get(sessionId)?.has(tabId) ?? false;
  }

  replace(sessionId: string, tabIds: Iterable<string>): void {
    this.sessionTabs.set(sessionId, new Set(tabIds));
  }

  get(sessionId: string): string[] {
    return [...(this.sessionTabs.get(sessionId) ?? new Set<string>())];
  }
}
