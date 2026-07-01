import { BridgeService } from "./bridge-service.js";
import { ExtensionConnector } from "./extension-connector.js";
import { createServer } from "./server.js";
import { pathToFileURL } from "node:url";

export async function startUmbDaemon(port = 44777) {
  const connector = new ExtensionConnector();
  const service = new BridgeService(connector);
  const server = createServer(service);
  connector.attachToServer(server);

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return { connector, server, service };
}

const isMainModule =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  startUmbDaemon()
    .then(() => {
      console.log("UMB daemon listening on http://127.0.0.1:44777");
      console.log("UMB WebSocket bridge waiting on ws://127.0.0.1:44777/extension");
    })
    .catch((error) => {
      console.error("UMB daemon failed:", error);
      process.exit(1);
    });
}
