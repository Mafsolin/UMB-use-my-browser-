import path from "node:path";
import process from "node:process";

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

const repoDir = path.resolve(readOption("--repo-dir", path.resolve(import.meta.dirname, "..")));
const serverName = readOption("--server-name", "umb");
const command = process.execPath;
const args = [path.join(repoDir, "scripts", "start-mcp.mjs")];

const config = {
  mcpServers: {
    [serverName]: {
      command,
      args,
      cwd: repoDir
    }
  }
};

process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
