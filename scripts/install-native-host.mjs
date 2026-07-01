import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const hostName = "com.umb.use_my_browser";
const localAppData =
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
const projectRoot = path.resolve(import.meta.dirname, "..");
const extensionPath = path.resolve(projectRoot, "apps", "extension");
const daemonRuntimePath = path.resolve(
  projectRoot,
  "apps",
  "daemon",
  "dist",
  "native-host-runtime.js"
);
const nativeHostDir = path.join(localAppData, "UMB", "native-host");
const launcherPath = path.join(nativeHostDir, "umb-native-host.cmd");
const manifestPath = path.join(nativeHostDir, `${hostName}.json`);
const browserUserDataDir =
  process.env.UMB_BROWSER_USER_DATA_DIR ??
  process.env.UMB_COMET_USER_DATA_DIR ??
  path.join(localAppData, "Perplexity", "Comet", "User Data");

const registryKeys = [
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`,
  `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${hostName}`,
  `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${hostName}`,
  `HKCU\\Software\\Perplexity\\Comet\\NativeMessagingHosts\\${hostName}`
];

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function profileDirectories(userDataDir) {
  if (!fs.existsSync(userDataDir)) {
    throw new Error(`Browser user data directory does not exist: ${userDataDir}`);
  }

  return fs
    .readdirSync(userDataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === "Default" || /^Profile \d+$/.test(name));
}

function preferencesFilesForProfile(userDataDir, profileName) {
  const profileDir = path.join(userDataDir, profileName);
  return [
    path.join(profileDir, "Secure Preferences"),
    path.join(profileDir, "Preferences")
  ];
}

function findExtensionIdFromProfile(userDataDir, expectedExtensionPath) {
  const expectedPath = path.resolve(expectedExtensionPath);

  for (const profileName of profileDirectories(userDataDir)) {
    for (const preferencesPath of preferencesFilesForProfile(userDataDir, profileName)) {
      const preferences = readJsonIfPresent(preferencesPath);
      const settings = preferences?.extensions?.settings;
      if (!settings || typeof settings !== "object") {
        continue;
      }

      for (const [extensionId, rawEntry] of Object.entries(settings)) {
        const entry = rawEntry;
        if (!entry || typeof entry !== "object") {
          continue;
        }

        if (typeof entry.path !== "string") {
          continue;
        }

        if (path.resolve(entry.path) === expectedPath) {
          return {
            extensionId,
            profileName,
            preferencesPath
          };
        }
      }
    }
  }

  return null;
}

function resolveExtensionId() {
  const envExtensionId = process.env.UMB_EXTENSION_ID;
  if (envExtensionId) {
    return {
      extensionId: envExtensionId,
      source: "UMB_EXTENSION_ID",
      profileName: null,
      preferencesPath: null
    };
  }

  const detected = findExtensionIdFromProfile(browserUserDataDir, extensionPath);
  if (!detected) {
    throw new Error(
      [
        "Could not detect the UMB extension ID from the current browser profile.",
        "Load the unpacked extension from ./apps/extension once,",
        "or set UMB_EXTENSION_ID explicitly before running install-native-host."
      ].join(" ")
    );
  }

  return {
    extensionId: detected.extensionId,
    source: "browser preferences",
    profileName: detected.profileName,
    preferencesPath: detected.preferencesPath
  };
}

function writeLauncher() {
  fs.mkdirSync(nativeHostDir, { recursive: true });
  const launcher = [
    "@echo off",
    `\"${process.execPath}\" \"${daemonRuntimePath}\"`,
    ""
  ].join("\r\n");
  fs.writeFileSync(launcherPath, launcher, "utf8");
}

function writeManifest(extensionId) {
  const manifest = {
    name: hostName,
    description: "UMB (Use My Browser) native host",
    path: launcherPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function writeRegistryKeys() {
  for (const registryKey of registryKeys) {
    execFileSync("reg", ["add", registryKey, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], {
      stdio: "ignore"
    });
  }
}

function main() {
  if (!fs.existsSync(daemonRuntimePath)) {
    throw new Error(
      `Missing native host runtime at ${daemonRuntimePath}. Run pnpm --filter @umb/daemon build first.`
    );
  }

  const extension = resolveExtensionId();
  writeLauncher();
  writeManifest(extension.extensionId);
  writeRegistryKeys();

  console.log(`UMB native host installed.`);
  console.log(`Host name: ${hostName}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Launcher: ${launcherPath}`);
  console.log(`Extension ID: ${extension.extensionId}`);
  console.log(`Extension ID source: ${extension.source}`);
  if (extension.profileName) {
    console.log(`Browser profile: ${extension.profileName}`);
  }
  if (extension.preferencesPath) {
    console.log(`Preferences: ${extension.preferencesPath}`);
  }
}

main();
