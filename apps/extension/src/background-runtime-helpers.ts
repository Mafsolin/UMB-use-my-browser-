export type NavigationProbeState = {
  href?: string;
  url?: string;
  title?: string;
  readyState?: string;
  documentHtml?: string;
};

export function isBootstrapUrl(url: string | undefined): boolean {
  return !url || url.startsWith("about:blank") || url.startsWith("chrome://newtab");
}

export function isCommittedNavigation(
  state: NavigationProbeState,
  requestedUrl: string,
  previousUrl?: string
): boolean {
  const currentUrl = state.href ?? state.url;
  if (!currentUrl) {
    return false;
  }

  if (currentUrl === requestedUrl) {
    return true;
  }

  if (previousUrl && currentUrl === previousUrl && requestedUrl !== previousUrl) {
    return false;
  }

  if (requestedUrl.startsWith("data:") || requestedUrl.startsWith("blob:")) {
    return !isBootstrapUrl(currentUrl);
  }

  return !isBootstrapUrl(currentUrl);
}

export function isUsableNavigationState(
  state: NavigationProbeState,
  requestedUrl: string,
  previousUrl?: string
): boolean {
  const domReady =
    state.readyState === "interactive" || state.readyState === "complete";
  const currentUrl = state.href ?? state.url;
  const domReadable = Boolean(
    (state.title && state.title.length > 0) ||
      (state.documentHtml && state.documentHtml.length > 0)
  );

  if (!isCommittedNavigation(state, requestedUrl, previousUrl)) {
    return false;
  }

  if (!domReady) {
    return false;
  }

  if (requestedUrl.startsWith("data:") || requestedUrl.startsWith("blob:")) {
    return domReadable || !isBootstrapUrl(currentUrl);
  }

  return !isBootstrapUrl(currentUrl) && domReadable;
}

export function collectFinalizeTabIds(input: {
  ownedTabIds: string[];
  sessionTabIds: Iterable<number>;
  registryTabIds: Iterable<number>;
  attachedTabIds: Iterable<number>;
}): number[] {
  return [...new Set<number>([
    ...input.ownedTabIds.map((entry) => Number(entry)).filter(Number.isInteger),
    ...input.sessionTabIds,
    ...input.registryTabIds,
    ...input.attachedTabIds
  ])];
}

export function filterAttachedTabIdsForSession(input: {
  attachedTabIds: Iterable<number>;
  sessionTabIds: Iterable<number>;
  registryTabIds: Iterable<number>;
}): number[] {
  const ownedSet = new Set<number>([
    ...input.sessionTabIds,
    ...input.registryTabIds
  ]);

  return [...new Set<number>([...input.attachedTabIds].filter((tabId) => ownedSet.has(tabId)))];
}
