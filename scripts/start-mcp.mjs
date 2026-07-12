import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const build = process.platform === "win32"
  ? spawnSync("cmd.exe", ["/d", "/s", "/c", "pnpm --filter @umb/daemon build 1>&2"], {
      cwd: rootDir,
      stdio: ["ignore", "ignore", "inherit"]
    })
  : spawnSync("pnpm", ["--filter", "@umb/daemon", "build"], {
      cwd: rootDir,
      stdio: ["ignore", "ignore", "inherit"]
    });

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const { ensureDaemonRunning } = await import(
  pathToFileURL(path.join(rootDir, "apps/daemon/dist/daemon-lifecycle.js")).href
);
await ensureDaemonRunning();

const [{ HttpBridgeService }, { startUmbMcp }] = await Promise.all([
  import(pathToFileURL(path.join(rootDir, "apps/daemon/dist/http-bridge-service.js")).href),
  import(pathToFileURL(path.join(rootDir, "apps/daemon/dist/mcp.js")).href)
]);

const server = await startUmbMcp(new HttpBridgeService());
globalThis.__umbMcpServer = server;

// Keep the stdio runtime alive even before the transport owns another active handle.
setInterval(() => {}, 60_000);
