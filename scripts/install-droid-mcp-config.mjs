import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

function readOption(name, fallback = undefined) {
  const prefix = `${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) {
    return direct.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }

  return fallback;
}

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const repoDir = path.resolve(readOption("--repo-dir", path.resolve(import.meta.dirname, "..")));
const serverName = readOption("--server-name", "umb");
const factoryHome = readOption("--factory-home", path.join(os.homedir(), ".factory"));
const configPath = path.resolve(readOption("--config", path.join(factoryHome, "mcp.json")));
const startScriptPath = path.join(repoDir, "scripts", "start-mcp.mjs");

fs.mkdirSync(path.dirname(configPath), { recursive: true });

const current = readJsonIfPresent(configPath);
const next = {
  ...current,
  mcpServers: {
    ...(current.mcpServers && typeof current.mcpServers === "object" ? current.mcpServers : {}),
    [serverName]: {
      command: process.execPath,
      args: [startScriptPath],
      cwd: repoDir
    }
  }
};

fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

const renderedBlock = spawnSync(process.execPath, [
  path.join(repoDir, "scripts", "print-droid-mcp-config.mjs"),
  "--repo-dir",
  repoDir,
  "--server-name",
  serverName
], {
  encoding: "utf8"
});

console.log(`Droid MCP config written: ${configPath}`);
console.log(`Server name: ${serverName}`);
if (renderedBlock.status === 0) {
  console.log("Installed block:");
  process.stdout.write(renderedBlock.stdout);
}
