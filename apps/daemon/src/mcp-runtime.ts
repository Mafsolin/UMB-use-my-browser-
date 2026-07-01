import { HttpBridgeService } from "./http-bridge-service.js";
import { startUmbMcp } from "./mcp.js";
import { pathToFileURL } from "node:url";

async function main() {
  await startUmbMcp(new HttpBridgeService());
}

const isMainModule =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error("UMB MCP server failed:", error);
    process.exit(1);
  });
}
