#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const localAppData =
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const browserUserDataDir =
  process.env.UMB_BROWSER_USER_DATA_DIR ||
  process.env.UMB_COMET_USER_DATA_DIR ||
  path.join(localAppData, "Perplexity", "Comet", "User Data");
const extensionPath = path.resolve(__dirname, "..", "apps", "extension");

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function profileDirectories(userDataDir) {
  if (!fs.existsSync(userDataDir)) {
    return [];
  }

  return fs
    .readdirSync(userDataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === "Default" || /^Profile \d+$/.test(name));
}

const results = [];
for (const profileName of profileDirectories(browserUserDataDir)) {
  const preferencesCandidates = [
    path.join(browserUserDataDir, profileName, "Secure Preferences"),
    path.join(browserUserDataDir, profileName, "Preferences")
  ];

  for (const preferencesPath of preferencesCandidates) {
    const preferences = readJsonIfPresent(preferencesPath);
    const settings = preferences?.extensions?.settings;
    if (!settings || typeof settings !== "object") {
      continue;
    }

    for (const [extensionId, rawEntry] of Object.entries(settings)) {
      const entry = rawEntry;
      if (!entry || typeof entry !== "object" || typeof entry.path !== "string") {
        continue;
      }

      if (path.resolve(entry.path) !== extensionPath) {
        continue;
      }

      results.push({
        profileName,
        preferencesPath,
        extensionId,
        state: entry.state ?? null,
        registeredPath: entry.path
      });
    }
  }
}

console.log(
  JSON.stringify(
    {
      browserUserDataDir,
      extensionPath,
      configuredExtensionId: process.env.UMB_EXTENSION_ID ?? null,
      found: results.length > 0,
      results
    },
    null,
    2
  )
);
