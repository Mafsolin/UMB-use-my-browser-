import { connectToNativeHost } from "./connection.js";
import { extensionState } from "./bridge-state.js";
import { refreshAttachedTabsFromBrowser } from "./debugger.js";
import { cleanupDanglingSessionEntries } from "./permissions.js";

function updateBadge() {
  const text = extensionState.uiStatus.connected ? "ON" : "OFF";
  const color = extensionState.uiStatus.connected ? "#157347" : "#a61e4d";
  void chrome.action.setBadgeText({ text });
  void chrome.action.setBadgeBackgroundColor({ color });
}

updateBadge();
void refreshAttachedTabsFromBrowser();
void cleanupDanglingSessionEntries();
connectToNativeHost();
