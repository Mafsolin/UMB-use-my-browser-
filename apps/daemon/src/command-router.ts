import type { BridgeCommand } from "@umb/protocol";
import type { BrowserConnector } from "@umb/core";

export function createCommandRouter(transport: BrowserConnector) {
  return async (command: BridgeCommand): Promise<unknown> => {
    switch (command.type) {
      case "openTabs":
        return transport.openTabs();
      case "claimTab":
        return transport.claimTab(String(command.params.tabId));
      case "newTab":
        return transport.newTab();
      case "goto":
        return transport.goto(
          String(command.params.tabId),
          String(command.params.url)
        );
      case "getUrl":
        return transport.getUrl(String(command.params.tabId));
      case "getTitle":
        return transport.getTitle(String(command.params.tabId));
      case "domSnapshot":
        return transport.domSnapshot(String(command.params.tabId));
      case "click":
        return transport.click(
          String(command.params.tabId),
          String(command.params.selector)
        );
      case "fill":
        return transport.fill(
          String(command.params.tabId),
          String(command.params.selector),
          String(command.params.value)
        );
      case "scroll":
        return transport.scroll(
          String(command.params.tabId),
          Number(command.params.x),
          Number(command.params.y)
        );
      case "screenshot":
        return transport.screenshot(String(command.params.tabId));
      default:
        throw new Error(`Unsupported command: ${command.type}`);
    }
  };
}
