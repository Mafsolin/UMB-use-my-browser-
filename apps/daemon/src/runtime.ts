import { randomBytes } from "node:crypto";
import { BridgeService } from "./bridge-service.js";
import { ExtensionConnector } from "./extension-connector.js";
import { createServer } from "./server.js";
import { pathToFileURL } from "node:url";

const DEFAULT_ALLOWED_ORIGINS = ["chrome-extension://*"];

export function generateBridgeAuth(input?: {
  token?: string;
  allowedOrigins?: string[];
}): { bearerToken: string; allowedOrigins: string[] } {
  return {
    bearerToken: input?.token ?? randomBytes(32).toString("hex"),
    allowedOrigins: input?.allowedOrigins ?? [...DEFAULT_ALLOWED_ORIGINS]
  };
}

export function parseAllowedOrigins(envValue: string | undefined): string[] {
  if (!envValue) {
    return [...DEFAULT_ALLOWED_ORIGINS];
  }
  const parsed = envValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_ORIGINS];
}

export async function startUmbDaemon(
  port = 44777,
  auth = generateBridgeAuth({
    allowedOrigins: parseAllowedOrigins(process.env.UMB_ALLOWED_ORIGINS)
  })
) {
  const connector = new ExtensionConnector(auth);
  const service = new BridgeService(connector);
  const server = createServer(service, auth);
  const wsServer = connector.attachToServer(server);

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        server.removeListener("error", onError);
        wsServer.removeListener("error", onError);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      server.once("error", onError);
      wsServer.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        cleanup();
        resolve();
      });
    });
  } catch (error) {
    await new Promise<void>((resolve) => wsServer.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }

  return { connector, server, service, auth };
}

const isMainModule =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const configuredPort = Number(process.env.UMB_DAEMON_PORT ?? 44777);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
    ? configuredPort
    : 44777;
  startUmbDaemon(port)
    .then(() => {
      console.log(`UMB daemon listening on http://127.0.0.1:${port}`);
      console.log(`UMB WebSocket bridge waiting on ws://127.0.0.1:${port}/extension (auth required)`);
    })
    .catch((error) => {
      console.error("UMB daemon failed:", error);
      process.exit(1);
    });
}
