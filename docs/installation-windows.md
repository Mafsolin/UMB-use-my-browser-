# Install UMB on Windows

This is the supported installation path for UMB with any MCP-compatible client. Droid / Factory automation is optional and documented separately.

## Prerequisites

- Windows 10 or 11
- Git
- Node.js 22+
- pnpm 11+
- Chrome, Edge, Comet, or another compatible Chromium-family browser
- an MCP-compatible client

Check the toolchain:

```powershell
node --version
pnpm --version
git --version
```

## 1. Clone, install, and build

```powershell
git clone https://github.com/Mafsolin/UMB-use-my-browser-.git
cd UMB-use-my-browser-
pnpm install --frozen-lockfile
pnpm build
```

If pnpm asks you to approve dependency build scripts, inspect the list and run:

```powershell
pnpm approve-builds
```

## 2. Load the unpacked extension

1. Open the extension manager, for example `chrome://extensions/`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select `<repo>\apps\extension`.
5. Note the extension ID shown by the browser.

The extension must be installed in the browser profile whose tabs and signed-in state UMB should use.

## 3. Register native messaging

Run after loading the extension once:

```powershell
node .\scripts\check-extension-installed.js
node .\scripts\install-native-host.mjs
node .\scripts\check-native-host-manifest.js
```

The installer writes the native host files under `%LOCALAPPDATA%\UMB\native-host\` and registers per-user native messaging keys for supported Chromium-family browsers.

### Extension detection overrides

If detection fails, copy the extension ID from the extension manager and run:

```powershell
$env:UMB_EXTENSION_ID = '<32-character-extension-id>'
node .\scripts\install-native-host.mjs
```

For a non-default browser profile, point the installer at the profile root:

```powershell
$env:UMB_BROWSER_USER_DATA_DIR = 'C:\path\to\Chromium\User Data'
node .\scripts\install-native-host.mjs
```

The native-host installer and registry setup are currently Windows-oriented. Other operating systems require manual native messaging registration and are not part of the supported installer path.

## 4. Start the daemon

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-daemon.ps1
```

The script reuses an already healthy daemon. To rebuild and restart it:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-daemon.ps1 -Restart
```

### Custom port

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-daemon.ps1 -Port 45000
```

For a custom port, configure matching MCP/native-host URLs before installation or startup:

```powershell
$env:UMB_DAEMON_PORT = '45000'
$env:UMB_DAEMON_HTTP_URL = 'http://127.0.0.1:45000'
$env:UMB_DAEMON_WS_URL = 'ws://127.0.0.1:45000/extension'
```

Use one consistent port for the daemon, native host, and extension bridge.

## 5. Verify the bridge

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:44777/health'
```

Expected properties:

```text
ok                  True
extension.connected True
```

If `connected` is false:

1. confirm the unpacked extension is enabled;
2. reload it from the extension manager;
3. rerun the native-host installer and checker;
4. restart the daemon;
5. check the extension service-worker console and daemon output.

Local browser test page:

```text
http://127.0.0.1:44777/umb-test-page
```

## 6. Configure an MCP client

Canonical command:

```text
node C:\absolute\path\to\UMB-use-my-browser-\scripts\start-mcp.mjs
```

Generic configuration:

```json
{
  "mcpServers": {
    "use-my-browser": {
      "command": "node",
      "args": [
        "C:\\absolute\\path\\to\\UMB-use-my-browser-\\scripts\\start-mcp.mjs"
      ]
    }
  }
}
```

Some clients use a different top-level key or command registration UI. Preserve the command and absolute script path; adapt only the client-specific wrapper.

Operator helpers are also available:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-mcp.ps1
```

```cmd
scripts\start-mcp.cmd
```

Restart the MCP client after changing its server configuration.

## 7. First smoke test

From the MCP client:

1. create a session;
2. list tabs;
3. claim an existing non-sensitive tab or create a new tab;
4. read its title and URL;
5. read the page;
6. finalize the session.

Start with external side effects disabled. Enable navigation, typing, or side effects only when the task requires them.

## Update UMB

```powershell
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
node .\scripts\install-native-host.mjs
powershell -ExecutionPolicy Bypass -File .\scripts\start-daemon.ps1 -Restart
```

Then reload the unpacked extension. Existing MCP configuration remains valid when the repository path does not change.

## Uninstall or move the repository

Before moving the repository, update the absolute MCP script path and rerun `install-native-host.mjs`, because the native host launcher points to the installed runtime path.

To stop using UMB without deleting browser data:

1. remove or disable the unpacked extension;
2. remove the UMB entry from the MCP client;
3. stop the daemon;
4. remove the native host registration/files only if you no longer need them.

Do not delete browser profiles or unrelated Chromium native messaging entries.

## Common failures

### `UMB daemon is up but the extension is not connected`

Reload the extension, verify the native host, and check `/health` again.

### `Could not detect the UMB extension ID`

Load `apps\extension` once, set `UMB_EXTENSION_ID`, and rerun installation.

### `Browser user data directory does not exist`

Set `UMB_BROWSER_USER_DATA_DIR` to the correct Chromium user-data root.

### `Tab <id> is unknown to this session`

Claim the existing tab first or create it through UMB.

### `Another debugger is already attached`

DevTools or another automation extension owns that tab. Close the competing debugger or choose another tab.

### Navigation, typing, or side effects are disabled

Create a new session with only the required permission enabled. Permission failures are expected safety behavior.

### Screenshot timeout

Use the current build, which gives screenshot capture a dedicated timeout while retaining masking cleanup. If a browser still cannot capture a background tab, retry on a simple local test page and include sanitized daemon/extension diagnostics in a report.

### Comet blocks `data:` navigation

Use `http://127.0.0.1:44777/umb-test-page` for canonical interaction testing.

## Security flow

```text
browser extension
  -> native host bootstrap
  -> loopback auth endpoint
  -> authenticated WebSocket bridge
  -> daemon and MCP session
```

The daemon generates an ephemeral bridge token. The WebSocket handshake validates the bearer subprotocol and extension Origin. UMB sessions independently control navigation, typing, and external side effects.

See [Security Policy](../SECURITY.md), [usage examples](./usage-examples.md), and [Droid / Factory setup](./droid-cli.md).
