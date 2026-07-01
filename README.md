# UMB (Use My Browser)

[![CI](https://github.com/Mafsolin/UMB-use-my-browser-/actions/workflows/ci.yml/badge.svg)](https://github.com/Mafsolin/UMB-use-my-browser-/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

UMB is a local browser bridge for live Chromium-backed automation. It preserves the strongest parts of the Codex Chrome bridge while exposing a neutral local surface for multiple CLIs through MCP.

## Quick Start

```powershell
pnpm install
pnpm build
powershell -ExecutionPolicy Bypass -File .\scripts\start-daemon.ps1
node .\scripts\start-mcp.mjs
```

## What UMB provides

- real browser profile access
- whole-browser tab visibility
- support for non-active tab reads
- DOM snapshot and interaction primitives
- session naming and cleanup
- audit logging per browser command
- an installable skill layer for browser-required tasks
- a local WebSocket bridge between the daemon and the browser extension for v1
- native-host bootstrap so the installed extension can wake the daemon
- repository-level MIT licensing and GitHub Actions CI gates for `lint`, `typecheck`, `test`, and `build`

## Workspace Layout

- `apps/daemon` - local daemon, HTTP surface, WebSocket extension bridge, MCP entrypoint
- `apps/extension` - MV3 extension using `chrome.debugger`
- `packages/protocol` - shared schema and public command surface
- `packages/core` - session, policy, connector, and finalize logic
- `packages/skill` - `UMB` skill package and methodology references

## Runtime Model

- Client integration: MCP over stdio
- Local daemon: `http://127.0.0.1:44777`
- Extension bridge: `ws://127.0.0.1:44777/extension`
- Extension bootstrap: Chromium native messaging host `com.umb.use_my_browser`
- Browser target: Chromium-family browsers on Windows
- `Comet` is a tested compatibility target, not a required profile assumption

UMB v1 still uses the local WebSocket bridge for the live command stream. Native Messaging is used as a bootstrap path so the installed browser extension can locate or wake the daemon without relying on an external `--remote-debugging-port`.

## Security Model

- The daemon generates an ephemeral bearer token on startup for the extension bridge.
- The browser extension obtains that token through the local native host and a localhost-only auth bootstrap endpoint.
- The live WebSocket handshake accepts only a valid `bearer.<token>` subprotocol from the extension.
- Production bootstrap narrows the allowed Origin to the current `chrome-extension://<extension-id>/`.
- The internal `chrome-extension://*` wildcard is a fallback/dev-oriented default, not the intended production trust boundary.
- A literal `Authorization` header is not used for the browser WebSocket handshake because Chromium extension WebSocket APIs do not expose custom header control.

## CI And Quality Gates

- `LICENSE` is included in the repository root and recognized by GitHub as MIT.
- GitHub Actions runs `lint`, `typecheck`, `test`, and `build` on `push` and `pull_request`.
- Publish hygiene checks should verify both repo-tracked files and GitHub repo metadata.
