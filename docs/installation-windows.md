# UMB Installation on Windows

## Prerequisites

- Node.js 22+
- pnpm 11+
- A Chromium-family browser on Windows
- `Comet` is a tested browser path, but not required

## Install dependencies

```powershell
cd <repo>
pnpm install
pnpm approve-builds --all
```

## Build the workspace

```powershell
pnpm build
```

## Load the extension

1. Open your browser's extensions manager page.
2. Enable Developer Mode.
3. Choose `Load unpacked`.
4. Select `.\apps\extension`.
5. Confirm the extension is visible in the current browser profile.

## Register the native host bootstrap

This follows the flow:

`browser extension -> native host -> localhost auth bootstrap -> UMB daemon -> extension WebSocket bridge`

After the unpacked extension is loaded once, run:

```powershell
node .\scripts\check-extension-installed.js
node .\scripts\install-native-host.mjs
node .\scripts\check-native-host-manifest.js
```

Expected result:

- the extension is detected in the current browser profile, or you provide `UMB_EXTENSION_ID`
- the native host manifest exists under `%LOCALAPPDATA%\UMB\native-host\`
- registry keys are written for Chromium-family browsers, including optional `Comet` support

## Bridge security model

- the daemon generates an ephemeral bearer token at startup for the extension bridge
- the native host fetches bridge bootstrap data from the localhost-only auth endpoint
- the extension does not attempt the WebSocket bridge until bootstrap returns a bearer token
- the WebSocket handshake validates both:
  - a matching `bearer.<token>` subprotocol
  - an allowed `chrome-extension://<id>/` Origin in the production bootstrap path
- `chrome-extension://*` is an internal fallback/dev-oriented default and should not be treated as the production trust model
- a literal `Authorization` header is not used for the browser WebSocket because Chromium extension WebSocket APIs do not provide custom header control

## Start the daemon

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-daemon.ps1
```

If the daemon is already running, this command reuses the current process and exits cleanly.
To force a restart:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-daemon.ps1 -Restart
```

Expected result:

- daemon listens on `http://127.0.0.1:44777`
- extension bridge endpoint is available at `ws://127.0.0.1:44777/extension`
- audit log writes to `.umb-runtime\audit.log.jsonl`

## Verify the extension connection

Check the daemon health endpoint:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:44777/health'
```

Expected shape:

```text
ok        : True
extension : @{connected=True; lastConnectedAt=...; clientLabel=UMB Chrome extension}
```

Local interaction test page:

```text
http://127.0.0.1:44777/umb-test-page
```

Repository status proof-points:

- `LICENSE` is present in the repo root and recognized by GitHub as MIT
- `.github/workflows/ci.yml` runs CI on `push` and `pull_request`

## Run the MCP surface

Operator helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-mcp.ps1
```

Canonical stdio entrypoint for other CLIs:

```text
node ./scripts/start-mcp.mjs
```

Register the server under `use-my-browser` or a local alias such as `umb`.

## Common failure modes

- `UMB daemon is up but the extension is not connected.`
  Reload the unpacked extension and re-check `/health`.
- `Could not detect the UMB extension ID from the current browser profile.`
  Load unpacked from `.\apps\extension` once, then rerun `node .\scripts\install-native-host.mjs`, or set `UMB_EXTENSION_ID`.
- `Browser user data directory does not exist: ...`
  Point `UMB_BROWSER_USER_DATA_DIR` at the correct Chromium-family profile root.
- `Tab <id> is unknown to this session.`
  Call `umb_claim_tab` first for an existing tab, or create a fresh one with `umb_new_tab`.
- `Another debugger is already attached to the tab with id: ...`
  Another browser tool, debugger, or extension already owns that tab. Pick another tab or release the external debugger first.
- `Navigation is disabled for session ...`
  Recreate the session with navigation enabled.
- `Typing is disabled for session ...`
  Recreate the session with typing enabled.
- `Side effects are disabled by session permissions ...`
  Recreate the session with side effects enabled only when you really want live writes.
- `Browser blocked navigation ... net::ERR_ABORTED`
  In `Comet`, treat `data:` pages as non-canonical for UMB validation. Use `http://127.0.0.1:44777/umb-test-page` for interaction tests.
