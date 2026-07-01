import type { ExtensionRequest } from "./messages.js";
import {
  claimTab,
  getTitle,
  getUrl,
  goto,
  nameSession,
  newTab,
  openTabs,
  startSession,
  tabIdFromString
} from "./tabs.js";
import { click, domSnapshot, fill, scroll, submit } from "./dom.js";
import { screenshot } from "./screenshots.js";
import { finalize, type FinalizeKeepEntry } from "./permissions.js";
import { getStatusResponse, syncSessionStatus } from "./status.js";

export async function handleRequest(message: ExtensionRequest): Promise<unknown> {
  switch (message.type) {
    case "startSession":
      return startSession(
        message.payload.sessionId,
        message.payload.clientId,
        message.payload.name
      );
    case "getStatus":
      syncSessionStatus();
      return getStatusResponse();
    case "openTabs":
      return openTabs();
    case "claimTab":
      return claimTab(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId)
      );
    case "newTab":
      return newTab(message.payload.sessionId);
    case "goto":
      return goto(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId),
        message.payload.url
      );
    case "getUrl":
      return getUrl(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId)
      );
    case "getTitle":
      return getTitle(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId)
      );
    case "domSnapshot":
      return domSnapshot(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId)
      );
    case "click":
      return click(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId),
        message.payload.selector
      );
    case "fill":
      return fill(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId),
        message.payload.selector,
        message.payload.value
      );
    case "submit":
      return submit(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId),
        message.payload.selector
      );
    case "scroll":
      return scroll(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId),
        message.payload.x,
        message.payload.y
      );
    case "screenshot":
      return screenshot(
        message.payload.sessionId,
        tabIdFromString(message.payload.tabId)
      );
    case "nameSession":
      return nameSession(message.payload.sessionId, message.payload.name);
    case "finalize":
      return finalize(
        message.payload.sessionId,
        message.payload.keep as FinalizeKeepEntry[],
        message.payload.ownedTabIds
      );
  }
}

