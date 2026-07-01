param()

$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\.."

# Keep MCP stdio clean: build output must not go to stdout before the server starts.
cmd /c "pnpm --filter @umb/daemon build 1>&2"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to build @umb/daemon before starting MCP."
}
node .\apps\daemon\dist\mcp-runtime.js
