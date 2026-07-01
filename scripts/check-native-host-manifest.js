#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const hostName = "com.umb.use_my_browser";
const localAppData =
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const manifestPath = path.join(localAppData, "UMB", "native-host", `${hostName}.json`);
const registryKeys = [
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`,
  `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${hostName}`,
  `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${hostName}`,
  `HKCU\\Software\\Perplexity\\Comet\\NativeMessagingHosts\\${hostName}`
];

function readRegistryDefaultValue(registryKey) {
  try {
    const output = execFileSync("reg", ["query", registryKey, "/ve"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const match = output.match(/\(Default\)\s+REG_\w+\s+(.+?)\s*$/m);
    return match ? match[1].replace(/^"(.*)"$/, "$1") : null;
  } catch {
    return null;
  }
}

const manifestExists = fs.existsSync(manifestPath);
const manifest = manifestExists ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
const registry = registryKeys.map((registryKey) => ({
  registryKey,
  manifestPath: readRegistryDefaultValue(registryKey)
}));

console.log(
  JSON.stringify(
    {
      hostName,
      manifestPath,
      manifestExists,
      allowedOrigins: manifest?.allowed_origins ?? [],
      launcherPath: manifest?.path ?? null,
      registry
    },
    null,
    2
  )
);
