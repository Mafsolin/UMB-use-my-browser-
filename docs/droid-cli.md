# UMB For Droid / Factory

Use this flow when you want an agent to install UMB from a GitHub repository with minimal machine-specific setup.

## What the installer does

- clones or updates the repository from a GitHub URL
- runs `pnpm install` and `pnpm build`
- installs the native host when the unpacked extension is already detectable
- writes a Droid MCP config to `~/.factory/mcp.json`
- starts the local daemon and checks `http://127.0.0.1:44777/health`

## One-command install from a cloned repo

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-droid-umb.ps1
```

## Install from only a GitHub repo URL

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-droid-umb.ps1 -RepoUrl https://github.com/Mafsolin/UMB-use-my-browser-
```

Default clone target:

```text
%LOCALAPPDATA%\UMB\github\umb
```

Optional custom target:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-droid-umb.ps1 `
  -RepoUrl https://github.com/Mafsolin/UMB-use-my-browser- `
  -InstallDir C:\tools\umb
```

## Browser-owned step

Chromium does not expose a safe generic API for silently installing an unpacked extension into the active user profile.

That means the installer can automate everything except this one browser-owned step:

1. Open Extensions in the target Chromium-family browser.
2. Enable Developer Mode.
3. Choose `Load unpacked`.
4. Select `apps\extension` inside the cloned repo.

After that, rerun the installer or run:

```powershell
node .\scripts\install-native-host.mjs
```

If an agent performs the install, it should explicitly tell the user these browser steps after the automated part finishes:

1. Open the target Chromium-family browser.
2. Open Extensions.
3. Enable Developer Mode.
4. Choose `Load unpacked`.
5. Select `apps\extension` inside the installed UMB repo.

## MCP config output

The installed config entry is written into:

```text
%USERPROFILE%\.factory\mcp.json
```

Equivalent block:

```json
{
  "mcpServers": {
    "umb": {
      "command": "node",
      "args": ["<absolute path to repo>\\scripts\\start-mcp.mjs"],
      "cwd": "<absolute path to repo>"
    }
  }
}
```

If you only want to print the block:

```powershell
node .\scripts\print-droid-mcp-config.mjs
```

If you want to install just the MCP config:

```powershell
node .\scripts\install-droid-mcp-config.mjs
```
