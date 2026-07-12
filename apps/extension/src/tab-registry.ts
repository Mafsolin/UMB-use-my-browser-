export type TabRegistryEntry = {
  tabId: number;
  createdByUmb: boolean;
  claimed: boolean;
  sessionId?: string;
  tabGroup?: string;
  keptStatus?: "deliverable" | "handoff";
};

export class TabRegistry {
  private readonly entries = new Map<number, TabRegistryEntry>();

  markCreated(tabId: number, sessionId: string, tabGroup?: string): void {
    this.entries.set(tabId, {
      tabId,
      createdByUmb: true,
      claimed: false,
      sessionId,
      tabGroup
    });
  }

  markClaimed(tabId: number, sessionId: string): void {
    const existing = this.entries.get(tabId);
    this.entries.set(tabId, {
      tabId,
      createdByUmb: existing?.createdByUmb ?? false,
      claimed: true,
      sessionId,
      tabGroup: existing?.tabGroup,
      keptStatus: existing?.keptStatus
    });
  }

  markDetached(tabId: number): void {
    const existing = this.entries.get(tabId);
    if (!existing) {
      return;
    }

    this.entries.set(tabId, {
      ...existing,
      claimed: false,
      sessionId: undefined
    });
  }

  markTabGroup(tabId: number, tabGroup?: string): void {
    const existing = this.entries.get(tabId);
    if (!existing) {
      return;
    }

    this.entries.set(tabId, {
      ...existing,
      tabGroup
    });
  }

  markKeep(tabId: number, status: "deliverable" | "handoff"): void {
    const existing = this.entries.get(tabId);
    this.entries.set(tabId, {
      tabId,
      createdByUmb: existing?.createdByUmb ?? false,
      claimed: existing?.claimed ?? false,
      sessionId: existing?.sessionId,
      tabGroup: existing?.tabGroup,
      keptStatus: status
    });
  }

  get(tabId: number): TabRegistryEntry | undefined {
    return this.entries.get(tabId);
  }

  values(): TabRegistryEntry[] {
    return [...this.entries.values()];
  }

  valuesForSession(sessionId: string): TabRegistryEntry[] {
    return this.values().filter((entry) => entry.sessionId === sessionId);
  }

  delete(tabId: number): void {
    this.entries.delete(tabId);
  }
}
