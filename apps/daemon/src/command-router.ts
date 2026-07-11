import type { BridgeCommand } from "@umb/protocol";
import type { BrowserConnector } from "@umb/core";

export function createCommandRouter(transport: BrowserConnector) {
  return async (command: BridgeCommand): Promise<unknown> => {
    switch (command.type) {
      case "openTabs":
        return transport.openTabs();
      case "claimTab":
        return transport.claimTab(command.params.tabId);
      case "newTab":
        return transport.newTab(command.params.url);
      case "goto":
        return transport.goto(command.params.tabId, command.params.url);
      case "getUrl":
        return transport.getUrl(command.params.tabId);
      case "getTitle":
        return transport.getTitle(command.params.tabId);
      case "readPage":
        return transport.readPage(command.params.tabId, {
          format: command.params.format,
          maxChars: command.params.maxChars,
          includeMetadata: command.params.includeMetadata
        });
      case "findControls":
        return transport.findControls(command.params.tabId, {
          ...(command.params.query === undefined ? {} : { query: command.params.query }),
          ...(command.params.kind === undefined ? {} : { kind: command.params.kind }),
          visibleOnly: command.params.visibleOnly,
          limit: command.params.limit
        });
      case "domSnapshot":
        return transport.domSnapshot(command.params.tabId);
      case "click":
        return transport.click(command.params.tabId, command.params.selector);
      case "fill":
        return transport.fill(
          command.params.tabId,
          command.params.selector,
          command.params.value
        );
      case "submit":
        return transport.submit(command.params.tabId, command.params.selector);
      case "scroll":
        return transport.scroll(
          command.params.tabId,
          command.params.x,
          command.params.y
        );
      case "screenshot":
        return transport.screenshot(command.params.tabId);
      case "nameSession":
        return {
          sessionId: command.sessionId,
          name: command.params.name
        };
      case "finalize":
        return transport.finalize({
          sessionId: command.sessionId,
          keep: command.params.keep,
          ownedTabIds: []
        });
      default: {
        const _exhaustive: never = command;
        void _exhaustive;
        throw new Error(
          `Unsupported command: ${(command as { type: string }).type}`
        );
      }
    }
  };
}
