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
  connector.attachToServer(server);

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return { connector, server, service, auth };
}

const isMainModule =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  startUmbDaemon()
    .then(() => {
      console.log("UMB daemon listening on http://127.0.0.1:44777");
      console.log("UMB WebSocket bridge waiting on ws://127.0.0.1:44777/extension (auth required)");
    })
    .catch((error) => {
      console.error("UMB daemon failed:", error);
      process.exit(1);
    });
}
