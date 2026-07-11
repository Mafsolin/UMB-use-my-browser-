import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import type { CommandCapableBridge } from "./http-bridge-service.js";

async function createDefaultSession(service: CommandCapableBridge) {
  return await service.createSession({
    clientId: "mcp",
    permissions: {
      allowNavigation: true,
      allowTyping: true,
      allowExternalSideEffects: false
    }
  });
}

export function createUmbMcpServer(service: CommandCapableBridge) {
  const server = new McpServer({
    name: "use-my-browser",
    version: "0.1.0"
  });

  let currentSessionId: string | undefined;
  const sessions = new Set<string>();

  async function ensureCurrentSessionId() {
    if (currentSessionId && sessions.has(currentSessionId)) {
      return currentSessionId;
    }

    const createdSession = await createDefaultSession(service);
    sessions.add(createdSession.sessionId);
    currentSessionId = createdSession.sessionId;
    return currentSessionId;
  }

  async function resolveSessionId(input: { sessionId?: string }) {
    const sessionId = input.sessionId ?? await ensureCurrentSessionId();
    if (!sessions.has(sessionId)) {
      throw new Error(`Unknown MCP session ${sessionId}. Create it first with create_session.`);
    }
    return sessionId;
  }

  server.registerTool(
    "create_session",
    {
      description: "Create a new UMB bridge session.",
      inputSchema: {
        clientId: z.string().default("mcp"),
        allowNavigation: z.boolean().default(true),
        allowTyping: z.boolean().default(true),
        allowExternalSideEffects: z.boolean().default(false),
        name: z.string().min(1).optional(),
        makeCurrent: z.boolean().default(true)
      }
    },
    async (input) => {
      const createdSession = await service.createSession({
        clientId: input.clientId,
        permissions: {
          allowNavigation: input.allowNavigation,
          allowTyping: input.allowTyping,
          allowExternalSideEffects: input.allowExternalSideEffects
        }
      });
      sessions.add(createdSession.sessionId);
      if (input.name) {
        await service.executeCommand({
          type: "nameSession",
          sessionId: createdSession.sessionId,
          params: { name: input.name }
        });
      }
      if (input.makeCurrent) {
        currentSessionId = createdSession.sessionId;
      }
      return {
        content: [{ type: "text", text: JSON.stringify(service.getSession(createdSession.sessionId), null, 2) }]
      };
    }
  );

  server.registerTool(
    "open_tabs",
    { description: "List all tabs visible to UMB.", inputSchema: {} },
    async () => {
      const sessionId = await ensureCurrentSessionId();
      const result = await service.executeCommand({
        type: "openTabs",
        sessionId,
        params: {}
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.registerTool(
    "claim_tab",
    {
      description: "Claim an existing browser tab for this UMB session.",
      inputSchema: {
        sessionId: z.string().optional(),
        tabId: z.string()
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      const result = await service.executeCommand({
        type: "claimTab",
        sessionId,
        params: { tabId: input.tabId }
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.registerTool(
    "new_tab",
    {
      description: "Create a new background tab, optionally at a URL.",
      inputSchema: { url: z.string().url().optional() }
    },
    async (input) => {
      const sessionId = await ensureCurrentSessionId();
      const result = await service.executeCommand({
        type: "newTab",
        sessionId,
        params: input.url === undefined ? {} : { url: input.url }
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.registerTool(
    "goto",
    {
      description: "Navigate an existing UMB tab to a URL.",
      inputSchema: {
        sessionId: z.string().optional(),
        tabId: z.string(),
        url: z.string().url()
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      await service.executeCommand({
        type: "goto",
        sessionId,
        params: { tabId: input.tabId, url: input.url }
      });
      return {
        content: [{ type: "text", text: `Navigated tab ${input.tabId} to ${input.url}` }]
      };
    }
  );

  server.registerTool(
    "get_url",
    {
      description: "Read the current URL from a claimed or UMB-created tab.",
      inputSchema: {
        sessionId: z.string().optional(),
        tabId: z.string()
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      const result = await service.executeCommand({
        type: "getUrl",
        sessionId,
        params: { tabId: input.tabId }
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.registerTool(
    "get_title",
    {
      description: "Read the current title from a claimed or UMB-created tab.",
      inputSchema: {
        sessionId: z.string().optional(),
        tabId: z.string()
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      const result = await service.executeCommand({
        type: "getTitle",
        sessionId,
        params: { tabId: input.tabId }
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.registerTool(
    "read_page",
    {
      description: "Extract redacted page content in Markdown or plain text without exposing the raw DOM.",
      inputSchema: {
        sessionId: z.string().optional(),
        tabId: z.string(),
        format: z.enum(["markdown", "text"]).default("markdown"),
        maxChars: z.number().int().min(1).max(100_000).optional(),
        includeMetadata: z.boolean().default(true)
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      const result = await service.executeCommand({
        type: "readPage",
        sessionId,
        params: {
          tabId: input.tabId,
          format: input.format,
          ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars }),
          includeMetadata: input.includeMetadata
        }
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.registerTool(
    "find_controls",
    {
      description: "Search all redacted page controls by optional text and kind filters.",
      inputSchema: {
        sessionId: z.string().optional(),
        tabId: z.string(),
        query: z.string().min(1).max(2048).optional(),
        kind: z.enum(["link", "button", "input", "textarea", "select", "form", "contenteditable"]).optional(),
        visibleOnly: z.boolean().default(true),
        limit: z.number().int().min(1).max(100).default(50)
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      const result = await service.executeCommand({
        type: "findControls",
        sessionId,
        params: {
          tabId: input.tabId,
          ...(input.query === undefined ? {} : { query: input.query }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          visibleOnly: input.visibleOnly,
          limit: input.limit
        }
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.registerTool(
    "click",
    {
      description: "Click an element in a claimed or UMB-created tab.",
      inputSchema: {
        sessionId: z.string().optional(),
        tabId: z.string(),
        selector: z.string()
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      await service.executeCommand({
        type: "click",
        sessionId,
        params: { tabId: input.tabId, selector: input.selector }
      });
      return {
        content: [{ type: "text", text: `Clicked ${input.selector} on tab ${input.tabId}` }]
      };
    }
  );

  server.registerTool(
    "fill",
    {
      description: "Fill an input or textarea in a claimed or UMB-created tab.",
      inputSchema: {
        sessionId: z.string().optional(),
        tabId: z.string(),
        selector: z.string(),
        value: z.string()
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      await service.executeCommand({
        type: "fill",
        sessionId,
        params: { tabId: input.tabId, selector: input.selector, value: input.value }
      });
      return {
        content: [{ type: "text", text: `Filled ${input.selector} on tab ${input.tabId}` }]
      };
    }
  );

  server.registerTool(
    "submit",
    {
      description:
        "Submit a form or submit button in a claimed or UMB-created tab.",
      inputSchema: {
        sessionId: z.string().optional(),
        tabId: z.string(),
        selector: z.string()
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      await service.executeCommand({
        type: "submit",
        sessionId,
        params: { tabId: input.tabId, selector: input.selector }
      });
      return {
        content: [
          {
            type: "text",
            text: `Submitted ${input.selector} on tab ${input.tabId}`
          }
        ]
      };
    }
  );

  server.registerTool(
    "scroll",
    {
      description: "Scroll within a claimed or UMB-created tab.",
      inputSchema: {
        sessionId: z.string().optional(),
        tabId: z.string(),
        x: z.number(),
        y: z.number()
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      const result = await service.executeCommand({
        type: "scroll",
        sessionId,
        params: { tabId: input.tabId, x: input.x, y: input.y }
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.registerTool(
    "screenshot",
    {
      description: "Capture a screenshot from a tab.",
      inputSchema: {
        sessionId: z.string().optional(),
        tabId: z.string()
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      const result = await service.executeCommand({
        type: "screenshot",
        sessionId,
        params: { tabId: input.tabId }
      });
      return {
        content: [{ type: "text", text: String(result) }]
      };
    }
  );

  server.registerTool(
    "name_session",
    {
      description: "Attach a human-readable name to the current UMB session.",
      inputSchema: {
        sessionId: z.string().optional(),
        name: z.string().min(1)
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      const result = await service.executeCommand({
        type: "nameSession",
        sessionId,
        params: { name: input.name }
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.registerTool(
    "finalize",
    {
      description: "Finalize the current browser work and keep only deliverable or handoff tabs.",
      inputSchema: {
        sessionId: z.string().optional(),
        keep: z.array(
          z.object({
            id: z.string(),
            status: z.enum(["deliverable", "handoff"])
          })
        )
      }
    },
    async (input) => {
      const sessionId = await resolveSessionId(input);
      const result = await service.executeCommand({
        type: "finalize",
        sessionId,
        params: { keep: input.keep }
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  return server;
}

export async function startUmbMcp(service: CommandCapableBridge) {
  const server = createUmbMcpServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
