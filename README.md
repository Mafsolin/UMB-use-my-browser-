# UMB (Use My Browser)

[![CI](https://github.com/Mafsolin/UMB-use-my-browser-/actions/workflows/ci.yml/badge.svg)](https://github.com/Mafsolin/UMB-use-my-browser-/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

UMB is a local bridge that lets MCP-compatible agents work in your real Chromium browser: existing tabs, signed-in sessions, JavaScript-rendered pages, background tabs, page controls, screenshots, and controlled interaction. Browser-required work stays in the browser instead of silently falling back to HTTP or another browser surface.

## Platform and requirements

The supported installation path is **Windows + a Chromium-family browser**. Comet is tested, but Chrome, Edge, and other compatible Chromium browsers are valid targets.

Install before starting:

- Windows 10 or 11
- Git
- Node.js 22+
- pnpm 11+
- a Chromium-family browser
- an MCP-compatible client

## Quick install for any MCP client

### 1. Clone and build

```powershell
git clone https://github.com/Mafsolin/UMB-use-my-browser-.git
cd UMB-use-my-browser-
pnpm install --frozen-lockfile
pnpm build
```

### 2. Load the browser extension

1. Open the browser extension manager, for example `chrome://extensions/`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select the repository folder `apps\extension`.
5. Keep the extension installed in the profile that the agent should use.

### 3. Register the native host

After loading the extension once:

```powershell
node .\scripts\check-extension-installed.js
node .\scripts\install-native-host.mjs
node .\scripts\check-native-host-manifest.js
```

If automatic extension detection is unavailable, set `UMB_EXTENSION_ID` to the ID shown on the extension manager page and rerun the installer.

### 4. Verify the daemon and extension

The native host and canonical MCP command automatically start a detached daemon when no healthy daemon is available. Normally, no separate daemon command is required. After opening your MCP client or reloading the extension, verify it with:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:44777/health'
```

For setup diagnostics, foreground logs, or an explicit restart, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-daemon.ps1
```

The health response should report `ok: true` and `extension.connected: true`. You can test browser interaction at:

```text
http://127.0.0.1:44777/umb-test-page
```

The native host and MCP entrypoint share the same health-check-and-start lifecycle. Concurrent startup attempts are coalesced within a process, an existing healthy daemon is always reused, and startup diagnostics go to stderr so MCP stdout remains protocol-only.

### 5. Add UMB to an MCP client

The canonical stdio command is:

```text
node <absolute-path-to-repository>\scripts\start-mcp.mjs
```

Generic MCP configuration:

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

Use the equivalent server configuration format supported by your client. The checked-in [`mcp.json`](./mcp.json) is a repository-relative example for clients that support `cwd`.

For the complete setup, custom browser profiles, custom ports, updating, and troubleshooting, see [Windows installation](./docs/installation-windows.md).

## Droid / Factory automated install

Droid and Factory users can use the optional installer wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-droid-umb.ps1 -RepoUrl https://github.com/Mafsolin/UMB-use-my-browser-
```

It clones or updates UMB, installs dependencies, builds the workspace, writes `~/.factory/mcp.json`, starts the daemon, and installs the native host when the unpacked extension is detectable. Loading the unpacked extension may still require one browser click.

See [Droid / Factory installation](./docs/droid-cli.md) for details.

## Update an existing installation

```powershell
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
node .\scripts\install-native-host.mjs
powershell -ExecutionPolicy Bypass -File .\scripts\start-daemon.ps1 -Restart
```

Reload the unpacked extension from the extension manager after an extension build changes.

## Runtime model

- MCP integration: stdio through `scripts/start-mcp.mjs`
- daemon: `http://127.0.0.1:44777`
- extension bridge: `ws://127.0.0.1:44777/extension`
- native host: `com.umb.use_my_browser`
- browser control: Chrome DevTools Protocol through `chrome.debugger`
- audit log: `.umb-runtime/audit.log.jsonl`

UMB can read and interact with non-active tabs. A session must claim an existing tab or create a new UMB tab before controlling it.

## Security model

- The daemon binds to loopback.
- The extension bridge requires an ephemeral bearer WebSocket subprotocol and an allowed extension Origin.
- Session permissions independently control navigation, typing, and external side effects.
- Page reads and screenshots redact configured sensitive fields.
- UMB does not directly read cookies, saved passwords, local storage, or browser profile databases.

Only enable typing or external side effects when the task requires them. Local software running as the same user is not fully isolated from every localhost control surface. See [Security Policy](./SECURITY.md).

## Workspace

- `apps/daemon` — HTTP daemon, WebSocket bridge, native host runtime, and MCP entrypoint
- `apps/extension` — Manifest V3 browser extension
- `packages/protocol` — shared schemas and command contract
- `packages/core` — sessions, permissions, connector interfaces, and finalization
- `packages/skill` — browser-only agent skill and operating references

## Development and documentation

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```

CI runs the quality gates on both Linux and Windows.

- [Windows installation and troubleshooting](./docs/installation-windows.md)
- [Usage examples](./docs/usage-examples.md)
- [Droid / Factory setup](./docs/droid-cli.md)
- [Publish hygiene](./docs/publish-hygiene.md)
- [Security policy](./SECURITY.md)

## License

[MIT](./LICENSE)
