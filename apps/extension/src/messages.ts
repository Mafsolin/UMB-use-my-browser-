export type ExtensionRequest =
  | {
      id: string;
      type: "startSession";
      payload: { sessionId: string; clientId: string; name?: string };
    }
  | { id: string; type: "getStatus" }
  | { id: string; type: "openTabs" }
  | { id: string; type: "claimTab"; payload: { sessionId: string; tabId: string } }
  | { id: string; type: "newTab"; payload: { sessionId: string; url?: string } }
  | { id: string; type: "goto"; payload: { sessionId: string; tabId: string; url: string } }
  | { id: string; type: "getUrl"; payload: { sessionId: string; tabId: string } }
  | { id: string; type: "getTitle"; payload: { sessionId: string; tabId: string } }
  | {
      id: string;
      type: "readPage";
      payload: {
        sessionId: string;
        tabId: string;
        format: "markdown" | "text";
        maxChars?: number;
        includeMetadata: boolean;
      };
    }
  | {
      id: string;
      type: "findControls";
      payload: {
        sessionId: string;
        tabId: string;
        query?: string;
        kind?: "link" | "button" | "input" | "textarea" | "select" | "form" | "contenteditable";
        visibleOnly: boolean;
        limit: number;
      };
    }
  | { id: string; type: "domSnapshot"; payload: { sessionId: string; tabId: string } }
  | { id: string; type: "click"; payload: { sessionId: string; tabId: string; selector: string } }
  | {
      id: string;
      type: "fill";
      payload: { sessionId: string; tabId: string; selector: string; value: string };
    }
  | { id: string; type: "scroll"; payload: { sessionId: string; tabId: string; x: number; y: number } }
  | { id: string; type: "screenshot"; payload: { sessionId: string; tabId: string } }
  | { id: string; type: "submit"; payload: { sessionId: string; tabId: string; selector: string } }
  | {
      id: string;
      type: "nameSession";
      payload: { sessionId: string; name: string };
    }
  | {
      id: string;
      type: "finalize";
      payload: {
        sessionId: string;
        ownedTabIds: string[];
        keep: Array<{ id: string; status: "deliverable" | "handoff" }>;
      };
    };

export type ExtensionResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};
