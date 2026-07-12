import http from "node:http";
import { bridgeCommandSchema, bridgePermissionsSchema } from "@umb/protocol";
import { z, ZodError } from "zod";
import { BridgeService } from "./bridge-service.js";
import { routes } from "./routes.js";
import type { BridgeAuthConfig } from "./extension-connector.js";

const serverStartedAt = new Date().toISOString();
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const htmlHeaders = { "content-type": "text/html; charset=utf-8" };
const createSessionSchema = z.object({
  clientId: z.string().min(1),
  permissions: bridgePermissionsSchema
}).strict();
const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
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
      <form
        id="search-form"
        onsubmit="event.preventDefault(); document.title='UMB Submitted'; document.getElementById('status').textContent='submitted'; document.getElementById('submit-result').textContent=document.getElementById('search').value;"
      >
        <input
          id="search"
          name="search"
          type="text"
          value=""
          oninput="document.getElementById('echo').textContent=this.value;"
        />
        <button
          id="go"
          type="button"
          onclick="document.title='UMB Clicked'; document.getElementById('status').textContent='clicked';"
        >
          Go
        </button>
        <button
          id="submit-button"
          type="submit"
        >
          Submit
        </button>
      </form>
      <p id="echo"></p>
      <p id="submit-result"></p>
      <div class="spacer"></div>
    </main>
  </body>
</html>
`;

export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  return Boolean(remoteAddress && loopbackAddresses.has(remoteAddress));
}

export function isValidChromiumExtensionId(extensionId: string | undefined): extensionId is string {
  return typeof extensionId === "string" && /^[a-p]{32}$/i.test(extensionId);
}

export function originForExtensionId(extensionId: string): string {
  return `chrome-extension://${extensionId.toLowerCase()}/`;
}

export function resolveBootstrapAllowedOrigins(
  configuredOrigins: string[],
  extensionId: string | undefined
): string[] {
  if (!extensionId) {
    return [...configuredOrigins];
  }

  return [originForExtensionId(extensionId)];
}

const MAX_JSON_BODY_BYTES = 256 * 1024;

class RequestBodyTooLargeError extends Error {}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let receivedBytes = 0;
    let settled = false;

    const contentLength = Number(req.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
      reject(new RequestBodyTooLargeError("Request body is too large."));
      req.resume();
      return;
    }

    req.on("data", (chunk: Buffer | string) => {
      if (settled) {
        return;
      }
      receivedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      if (receivedBytes > MAX_JSON_BODY_BYTES) {
        settled = true;
        reject(new RequestBodyTooLargeError("Request body is too large."));
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      if (settled) {
        return;
      }
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export function createServer(
  service = new BridgeService(),
  bridgeAuth?: BridgeAuthConfig
) {
  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && requestUrl.pathname === "/internal/auth-bootstrap") {
        if (!bridgeAuth) {
          res.writeHead(503, jsonHeaders);
          res.end(JSON.stringify({ error: "UMB bridge auth not configured." }));
          return;
        }

        if (!isLoopbackAddress(req.socket.remoteAddress)) {
          res.writeHead(403, jsonHeaders);
          res.end(JSON.stringify({ error: "UMB auth bootstrap is only available from localhost." }));
          return;
        }

        const extensionId = requestUrl.searchParams.get("extensionId") ?? undefined;
        if (extensionId && !isValidChromiumExtensionId(extensionId)) {
          res.writeHead(400, jsonHeaders);
          res.end(JSON.stringify({ error: "Invalid Chromium extension id." }));
          return;
        }

        res.writeHead(200, jsonHeaders);
        res.end(
          JSON.stringify({
            token: bridgeAuth.bearerToken,
            allowedOrigins: resolveBootstrapAllowedOrigins(
              bridgeAuth.allowedOrigins,
              extensionId
            )
          })
        );
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === routes.createSession) {
        const body = createSessionSchema.parse(await readJsonBody(req));
        const session = service.createSession(body);
        res.writeHead(201, jsonHeaders);
        res.end(JSON.stringify(session));
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === routes.command) {
        const body = bridgeCommandSchema.parse(await readJsonBody(req));
        const result = await service.executeCommand(body);
        res.writeHead(200, jsonHeaders);
        res.end(JSON.stringify({ result }));
        return;
      }

      if (req.method === "GET" && requestUrl.pathname === "/health") {
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

      if (req.method === "GET" && requestUrl.pathname === "/umb-test-page") {
        res.writeHead(200, htmlHeaders);
        res.end(umbTestPageHtml);
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (error) {
      const status = error instanceof RequestBodyTooLargeError
        ? 413
        : error instanceof SyntaxError || error instanceof ZodError
          ? 400
          : 500;
      res.writeHead(status, jsonHeaders);
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  });
}
