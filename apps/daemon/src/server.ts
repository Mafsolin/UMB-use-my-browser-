import http from "node:http";
import { bridgeCommandSchema } from "@umb/protocol";
import { BridgeService } from "./bridge-service.js";
import { routes } from "./routes.js";

const serverStartedAt = new Date().toISOString();
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const htmlHeaders = { "content-type": "text/html; charset=utf-8" };
const umbTestPageHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>UMB Test Page</title>
    <style>
      body { font-family: sans-serif; margin: 0; padding: 24px; }
      main { max-width: 720px; }
      .spacer { height: 2200px; }
    </style>
  </head>
  <body>
    <main>
      <h1>UMB Local Test Page</h1>
      <p id="status">ready</p>
      <input
        id="search"
        type="text"
        value=""
        oninput="document.getElementById('echo').textContent=this.value;"
      />
      <p id="echo"></p>
      <button
        id="go"
        onclick="document.title='UMB Clicked'; document.getElementById('status').textContent='clicked';"
      >
        Go
      </button>
      <div class="spacer"></div>
    </main>
  </body>
</html>
`;

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export function createServer(service = new BridgeService()) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "POST" && req.url === routes.createSession) {
        const body = (await readJsonBody(req)) as {
          clientId: string;
          permissions: {
            allowNavigation: boolean;
            allowTyping: boolean;
            allowExternalSideEffects: boolean;
          };
        };
        const session = service.createSession(body);
        res.writeHead(201, jsonHeaders);
        res.end(JSON.stringify(session));
        return;
      }

      if (req.method === "POST" && req.url === routes.command) {
        const body = bridgeCommandSchema.parse(await readJsonBody(req));
        const result = await service.executeCommand(body);
        res.writeHead(200, jsonHeaders);
        res.end(JSON.stringify({ result }));
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        const extension = await service.getConnectionStatus();
        res.writeHead(200, jsonHeaders);
        res.end(
          JSON.stringify({
            ok: true,
            daemon: {
              pid: process.pid,
              startedAt: serverStartedAt
            },
            extension
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === "/umb-test-page") {
        res.writeHead(200, htmlHeaders);
        res.end(umbTestPageHtml);
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (error) {
      res.writeHead(500, jsonHeaders);
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  });
}
